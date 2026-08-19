import type { ToolTrace, TurnInput } from '@diqier/stratagate'

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function blocks(value: unknown): unknown[] {
  return Array.isArray(value) ? value : typeof value === 'string' ? [{ type: 'text', text: value }] : []
}

function blockText(value: unknown): string {
  const item = object(value)
  if (typeof item.text === 'string') return item.text
  if (typeof item.content === 'string') return item.content
  if (Array.isArray(item.content)) return item.content.map(blockText).filter(Boolean).join('\n')
  return ''
}

function normalized(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function isStrataGateTool(name: string): boolean {
  const lowered = name.toLowerCase()
  return lowered.includes('stratagate') || lowered.startsWith('mcp__stratagate') || lowered.startsWith('memory_')
}

function humanText(entry: JsonObject): string {
  if (entry.type !== 'user') return ''
  const message = object(entry.message)
  const content = blocks(message.content)
  if (content.some((block) => object(block).type === 'tool_result')) return ''
  return content
    .filter((block) => object(block).type === 'text')
    .map(blockText)
    .filter((value) => value && !value.includes('<stratagate_memory'))
    .join('\n')
    .trim()
}

function timestamp(entry: JsonObject): string | undefined {
  return typeof entry.timestamp === 'string' && Number.isFinite(Date.parse(entry.timestamp)) ? entry.timestamp : undefined
}

export function parseJsonLines(buffer: Buffer): { entries: JsonObject[]; consumedBytes: number } {
  const entries: JsonObject[] = []
  let start = 0
  let consumedBytes = 0
  while (start < buffer.length) {
    const newline = buffer.indexOf(0x0a, start)
    const end = newline === -1 ? buffer.length : newline
    const line = buffer.subarray(start, end).toString('utf8').trim()
    if (line) {
      try {
        const parsed = JSON.parse(line)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) entries.push(parsed as JsonObject)
      } catch {
        if (newline === -1) break
      }
    }
    consumedBytes = newline === -1 ? buffer.length : newline + 1
    start = newline === -1 ? buffer.length : newline + 1
  }
  return { entries, consumedBytes }
}

export function foldLatestTurn(
  entries: readonly JsonObject[],
  prompt: string | undefined,
  fallbackAssistant?: string,
): TurnInput | null {
  let start = -1
  const wanted = normalized(prompt ?? '')
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const candidate = humanText(entries[index] ?? {})
    if (!candidate) continue
    if (!wanted || normalized(candidate) === wanted) {
      start = index
      break
    }
    if (start === -1) start = index
  }
  if (start < 0 && !wanted) return null

  const selected = entries.slice(Math.max(0, start))
  const user = prompt?.trim() || humanText(selected[0] ?? {})
  if (!user) return null

  const toolById = new Map<string, ToolTrace>()
  const assistantParts: string[] = []
  let createdAt: string | undefined
  for (const entry of selected) {
    createdAt ??= timestamp(entry)
    const message = object(entry.message)
    if (entry.type === 'assistant') {
      for (const block of blocks(message.content)) {
        const item = object(block)
        if (item.type === 'text') {
          const value = blockText(item).trim()
          if (value && !value.includes('<stratagate_memory')) assistantParts.push(value)
        }
        if (item.type === 'tool_use' && typeof item.name === 'string' && !isStrataGateTool(item.name)) {
          const id = typeof item.id === 'string' ? item.id : `anonymous:${toolById.size}`
          toolById.set(id, {
            name: item.name,
            ...(object(item.input) && Object.keys(object(item.input)).length > 0 ? { arguments: object(item.input) } : {}),
          })
        }
      }
    }
    if (entry.type === 'user') {
      for (const block of blocks(message.content)) {
        const item = object(block)
        if (item.type !== 'tool_result') continue
        const id = typeof item.tool_use_id === 'string' ? item.tool_use_id : ''
        const trace = toolById.get(id)
        if (trace) trace.result = item.content
      }
    }
  }

  const assistant = assistantParts.join('\n\n').trim() || fallbackAssistant?.trim() || ''
  if (!assistant) return null
  const toolCalls = [...toolById.values()]
  return {
    user,
    assistant,
    ...(createdAt ? { createdAt } : {}),
    ...(toolCalls.length > 0 ? { assistantToolCalls: toolCalls } : {}),
  }
}
