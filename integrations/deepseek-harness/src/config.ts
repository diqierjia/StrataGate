import z from '@deepseek-ai/schemastery'

export type NamespaceMode = 'project' | 'session' | 'global'

export interface Config {
  database?: string
  namespaceMode?: NamespaceMode
  namespacePrefix?: string
  globalNamespace?: string
  blockTurnSize?: number
  ingestSubagents?: boolean
  provider?: string
  model?: string
  maxOutputTokens?: number
}

export interface ResolvedConfig {
  database: string
  namespaceMode: NamespaceMode
  namespacePrefix: string
  globalNamespace: string
  blockTurnSize: number
  ingestSubagents: boolean
  provider?: string
  model?: string
  maxOutputTokens: number
}

export const Config: z<Config> = z.object({
  database: z.string().required(),
  namespaceMode: z.union(['project', 'session', 'global'] as const).default('project'),
  namespacePrefix: z.string().default('dsh'),
  globalNamespace: z.string().default('global'),
  blockTurnSize: z.natural().min(1).default(4),
  ingestSubagents: z.boolean().default(false),
  provider: z.string(),
  model: z.string(),
  maxOutputTokens: z.natural().min(256).default(2_048),
})

export function resolveConfig(config: Config): ResolvedConfig {
  const database = config.database?.trim() ?? ''
  const namespacePrefix = config.namespacePrefix?.trim() || 'dsh'
  const globalNamespace = config.globalNamespace?.trim() || 'global'
  const provider = config.provider?.trim()
  const model = config.model?.trim()
  if (!database) throw new TypeError('StrataGate database path must not be empty')
  if (Boolean(provider) !== Boolean(model)) {
    throw new TypeError('StrataGate provider and model must be configured together')
  }
  return {
    database,
    namespaceMode: config.namespaceMode ?? 'project',
    namespacePrefix,
    globalNamespace,
    blockTurnSize: Math.max(1, Math.floor(config.blockTurnSize ?? 4)),
    ingestSubagents: config.ingestSubagents ?? false,
    ...(provider && model ? { provider, model } : {}),
    maxOutputTokens: Math.max(256, Math.floor(config.maxOutputTokens ?? 2_048)),
  }
}
