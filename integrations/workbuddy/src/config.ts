import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'

export interface ModelConfig {
  baseUrl: string
  model: string
  apiKey?: string
  maxOutputTokens: number
}

export interface WorkBuddyModelConfig {
  command: string
  commandArgs: string[]
  model: string
  timeoutMs: number
}

export interface WorkBuddyConfig {
  dataDir: string
  database: string
  projectDir: string
  namespace: string
  blockTurnSize: number
  retrievalLimit: number
  maxContextChars: number
  workerIntervalMs: number
  workBuddyModel?: WorkBuddyModelConfig
  model?: ModelConfig
}

function first(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find(Boolean)
}

function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
}

function disabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '')
}

function workBuddyCommand(env: NodeJS.ProcessEnv): Pick<WorkBuddyModelConfig, 'command' | 'commandArgs'> {
  const explicit = first(env.STRATAGATE_WORKBUDDY_CLI)
  if (explicit) {
    return ['.js', '.cjs', '.mjs'].includes(extname(explicit).toLowerCase())
      ? { command: process.execPath, commandArgs: [resolve(explicit)] }
      : { command: explicit, commandArgs: [] }
  }
  const bundledEntry = join(dirname(process.execPath), 'node_modules', '@tencent-ai', 'codebuddy-code', 'bin', 'codebuddy')
  if (existsSync(bundledEntry)) return { command: process.execPath, commandArgs: [bundledEntry] }
  return { command: process.platform === 'win32' ? 'codebuddy.cmd' : 'codebuddy', commandArgs: [] }
}

export function projectKey(cwd: string): string {
  const canonical = resolve(cwd).replaceAll('\\', '/').toLowerCase()
  return createHash('sha256').update(canonical).digest('hex').slice(0, 20)
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env, cwd?: string): WorkBuddyConfig {
  const dataDir = resolve(first(env.STRATAGATE_DATA_DIR, env.CODEBUDDY_PLUGIN_DATA, env.CLAUDE_PLUGIN_DATA)
    ?? join(homedir(), '.stratagate', 'workbuddy'))
  const projectDir = resolve(cwd ?? first(env.STRATAGATE_PROJECT_DIR, env.CODEBUDDY_PROJECT_DIR, env.CLAUDE_PROJECT_DIR)
    ?? process.cwd())
  const baseUrl = first(
    env.STRATAGATE_MODEL_BASE_URL,
    env.CODEBUDDY_PLUGIN_OPTION_MODEL_BASE_URL,
    env.CLAUDE_PLUGIN_OPTION_MODEL_BASE_URL,
  )
  const modelName = first(
    env.STRATAGATE_MODEL,
    env.CODEBUDDY_PLUGIN_OPTION_MODEL_NAME,
    env.CLAUDE_PLUGIN_OPTION_MODEL_NAME,
  )
  const apiKey = first(
    env.STRATAGATE_MODEL_API_KEY,
    env.CODEBUDDY_PLUGIN_OPTION_MODEL_API_KEY,
    env.CLAUDE_PLUGIN_OPTION_MODEL_API_KEY,
  )
  const model = baseUrl && modelName ? {
    baseUrl,
    model: modelName,
    ...(apiKey ? { apiKey } : {}),
    maxOutputTokens: integer(env.STRATAGATE_MODEL_MAX_OUTPUT_TOKENS, 2_048, 256, 16_384),
  } : undefined
  const workBuddyModel = disabled(env.STRATAGATE_DISABLE_WORKBUDDY_MODEL) ? undefined : {
    ...workBuddyCommand(env),
    model: first(env.STRATAGATE_WORKBUDDY_MODEL) ?? 'lite',
    timeoutMs: integer(env.STRATAGATE_WORKBUDDY_TIMEOUT_MS, 90_000, 5_000, 300_000),
  }

  return {
    dataDir,
    database: resolve(first(env.STRATAGATE_DATABASE) ?? join(dataDir, 'memory.db')),
    projectDir,
    namespace: `workbuddy:project:${projectKey(projectDir)}`,
    blockTurnSize: integer(env.STRATAGATE_BLOCK_TURN_SIZE, 4, 1, 100),
    retrievalLimit: integer(env.STRATAGATE_RETRIEVAL_LIMIT, 8, 1, 20),
    maxContextChars: integer(env.STRATAGATE_MAX_CONTEXT_CHARS, 12_000, 1_000, 50_000),
    workerIntervalMs: integer(env.STRATAGATE_WORKER_INTERVAL_MS, 3_000, 1_000, 60_000),
    ...(workBuddyModel ? { workBuddyModel } : {}),
    ...(model ? { model } : {}),
  }
}
