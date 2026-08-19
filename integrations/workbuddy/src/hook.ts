import { open, stat } from 'node:fs/promises'
import { resolveConfig } from './config.js'
import { WorkBuddyRuntime } from './runtime.js'
import { foldLatestTurn, parseJsonLines } from './transcript.js'

interface HookInput {
  session_id?: string
  transcript_path?: string
  cwd?: string
  hook_event_name?: string
  prompt?: string
  stop_hook_active?: boolean
  last_assistant_message?: string
}

interface Delta {
  entries: Record<string, unknown>[]
  startOffset: number
  endOffset: number
}

const MAX_DELTA_BYTES = 4 * 1024 * 1024

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function transcriptDelta(path: string, requestedOffset: number): Promise<Delta> {
  const info = await stat(path)
  let startOffset = requestedOffset >= 0 && requestedOffset <= info.size ? requestedOffset : 0
  if (info.size - startOffset > MAX_DELTA_BYTES) startOffset = Math.max(0, info.size - MAX_DELTA_BYTES)
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(Math.max(0, info.size - startOffset))
    if (buffer.length > 0) await handle.read(buffer, 0, buffer.length, startOffset)
    let payload = buffer
    if (startOffset > requestedOffset) {
      const newline = buffer.indexOf(0x0a)
      if (newline >= 0) {
        startOffset += newline + 1
        payload = buffer.subarray(newline + 1)
      }
    }
    const parsed = parseJsonLines(payload)
    return { entries: parsed.entries, startOffset, endOffset: startOffset + parsed.consumedBytes }
  } finally {
    await handle.close()
  }
}

function success(additionalContext?: string): unknown {
  return additionalContext ? {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext,
    },
  } : { continue: true, suppressOutput: true }
}

async function userPrompt(input: HookInput): Promise<unknown> {
  const sessionId = input.session_id?.trim()
  const prompt = input.prompt?.trim()
  if (!sessionId || !prompt) return success()
  const config = resolveConfig(process.env, input.cwd)
  const runtime = new WorkBuddyRuntime(config)
  await runtime.state.writePending(sessionId, {
    prompt,
    transcriptPath: input.transcript_path?.trim() ?? '',
    projectDir: config.projectDir,
    receivedAt: new Date().toISOString(),
  })
  const recalled = await runtime.initialContext(sessionId, prompt)
  return success(recalled.context || undefined)
}

async function stop(input: HookInput): Promise<unknown> {
  const sessionId = input.session_id?.trim()
  const transcriptPath = input.transcript_path?.trim()
  if (!sessionId || !transcriptPath) return success()
  const config = resolveConfig(process.env, input.cwd)
  const runtime = new WorkBuddyRuntime(config)
  const cursor = await runtime.state.readCursor(sessionId)
  const requestedOffset = cursor?.transcriptPath === transcriptPath ? cursor.offset : 0
  const delta = await transcriptDelta(transcriptPath, requestedOffset)
  if (delta.endOffset <= requestedOffset) return success()
  const pending = await runtime.state.readPending(sessionId)
  const turn = foldLatestTurn(delta.entries, pending?.prompt, input.last_assistant_message)
  if (!turn) return success()

  await runtime.appendTurn({
    ...turn,
    receiptId: `workbuddy:${sessionId}:transcript:${delta.startOffset}-${delta.endOffset}`,
  })
  await runtime.state.writeCursor(sessionId, {
    transcriptPath,
    offset: delta.endOffset,
    updatedAt: new Date().toISOString(),
  })
  return success()
}

async function main(): Promise<void> {
  let output: unknown = success()
  try {
    if (process.env.STRATAGATE_DISABLE_HOST_ADAPTER === '1') {
      process.stdout.write(`${JSON.stringify(output)}\n`)
      return
    }
    const input = JSON.parse(await readStdin()) as HookInput
    if (input.hook_event_name === 'UserPromptSubmit') output = await userPrompt(input)
    if (input.hook_event_name === 'Stop') output = await stop(input)
  } catch (error) {
    process.stderr.write(`[stratagate-workbuddy] hook failed open: ${error instanceof Error ? error.message : String(error)}\n`)
  }
  process.stdout.write(`${JSON.stringify(output)}\n`)
}

void main()
