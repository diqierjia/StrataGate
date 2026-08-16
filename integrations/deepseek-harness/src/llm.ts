import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type {
  BlockSummarizer,
  ElementProjectionContext,
  ElementProjectionResult,
  ElementProjector,
  EventCardInput,
  EventExtractor,
  ExtractionContext,
  MemoryCriticality,
  MemoryElementType,
  MemoryScope,
} from '@diqier/stratagate'
import type { ResolvedConfig } from './config.js'
import type {} from '@deepseek-ai/dsh-agent-default-model'

const ELEMENT_TYPES = new Set<MemoryElementType>(['person', 'project', 'organization', 'tool', 'place'])
const SCOPES = new Set<MemoryScope>(['user', 'project', 'session'])
const CRITICALITIES = new Set<MemoryCriticality>(['routine', 'preference', 'identity', 'safety'])

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function parseJsonResponse(value: string): unknown {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1))
    throw new Error('StrataGate model response was not valid JSON')
  }
}

export class DshModelBridge {
  private readonly sessions = new AsyncLocalStorage<Session>()

  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {}

  run<T>(session: Session, operation: () => Promise<T>): Promise<T> {
    return this.sessions.run(session, operation)
  }

  readonly summarizer: BlockSummarizer = async (messages) => {
    const raw = object(await this.callJson(
      'You compress agent conversations into durable memory blocks. Return JSON only with l0Title, l0Tags, l1Summary, l2Keypoints, shouldExtract. Preserve decisions, constraints, preferences, outcomes, and unresolved work. shouldExtract is true only when durable events or facts exist.',
      { messages },
    ))
    return {
      l0Title: text(raw.l0Title, 'Conversation block').slice(0, 120),
      l0Tags: strings(raw.l0Tags).slice(0, 12),
      l1Summary: text(raw.l1Summary).slice(0, 2_000),
      l2Keypoints: strings(raw.l2Keypoints).slice(0, 20),
      shouldExtract: raw.shouldExtract === true,
    }
  }

  readonly extractor: EventExtractor = async (context: ExtractionContext) => {
    const validMessageIds = new Set(context.target.l5Raw.map((message) => message.id))
    const raw = object(await this.callJson(
      'Extract only durable, evidence-backed events from target. Never invent source ids. Return JSON only: {shouldExtract:boolean,reason:string,events:[{title,summary,narrative,tags,quotes,sourceMessageIds,temporal,scope,criticality,confidence}]}. Events must be understandable later without the original chat. Use project scope for repository decisions, user scope for stable preferences/identity, and session scope for temporary task state. Do not turn an assistant statement that merely recalls older memory into a new event; require new human input or a new observable task/tool outcome from this target block.',
      context,
    ))
    const events = (Array.isArray(raw.events) ? raw.events : []).map((candidate): EventCardInput | null => {
      const item = object(candidate)
      const sourceMessageIds = strings(item.sourceMessageIds).filter((id) => validMessageIds.has(id))
      const scope = SCOPES.has(item.scope as MemoryScope) ? item.scope as MemoryScope : 'project'
      const criticality = CRITICALITIES.has(item.criticality as MemoryCriticality)
        ? item.criticality as MemoryCriticality
        : 'routine'
      if (!text(item.title) || !text(item.summary) || sourceMessageIds.length === 0) return null
      return {
        title: text(item.title).slice(0, 200),
        summary: text(item.summary).slice(0, 1_000),
        narrative: text(item.narrative),
        tags: strings(item.tags).slice(0, 16),
        quotes: strings(item.quotes).slice(0, 12),
        sourceMessageIds,
        sourceBlockId: context.target.id,
        temporal: object(item.temporal),
        scope,
        criticality,
        confidence: typeof item.confidence === 'number' ? item.confidence : 0.8,
      }
    }).filter((event): event is EventCardInput => event !== null)
    return {
      shouldExtract: raw.shouldExtract === true && events.length > 0,
      reason: text(raw.reason, events.length ? 'Durable evidence extracted.' : 'No durable evidence.'),
      events,
    }
  }

  readonly projector: ElementProjector = async (context: ElementProjectionContext): Promise<ElementProjectionResult> => {
    const eventIds = new Set(context.events.map((event) => event.id))
    const raw = object(await this.callJson(
      'Project event evidence into Element cards. Return JSON only: {reason,changes:[{element:{name,type,aliases},operation,key,mode,value,validFrom,validTo,sourceEventIds,confidence}]}. type is person/project/organization/tool/place. operation is set_state/add_set_item/set_relation. mode is state/set/relation. Use only supplied event ids and never create unsupported facts.',
      context,
    ))
    const changes = (Array.isArray(raw.changes) ? raw.changes : []).flatMap((candidate) => {
      const item = object(candidate)
      const element = object(item.element)
      const type = element.type as MemoryElementType
      const sourceEventIds = strings(item.sourceEventIds).filter((id) => eventIds.has(id))
      const operation = item.operation
      const mode = item.mode
      const value = item.value
      if (!text(element.name) || !ELEMENT_TYPES.has(type) || sourceEventIds.length === 0) return []
      if (!['set_state', 'add_set_item', 'set_relation'].includes(String(operation))) return []
      if (!['state', 'set', 'relation'].includes(String(mode))) return []
      if (!(typeof value === 'string' || (Array.isArray(value) && value.every((entry) => typeof entry === 'string')))) return []
      return [{
        element: { name: text(element.name), type, aliases: strings(element.aliases) },
        operation: operation as 'set_state' | 'add_set_item' | 'set_relation',
        key: text(item.key, 'state'),
        mode: mode as 'state' | 'set' | 'relation',
        value,
        ...(text(item.validFrom) ? { validFrom: text(item.validFrom) } : {}),
        ...(text(item.validTo) ? { validTo: text(item.validTo) } : {}),
        sourceEventIds,
        ...(typeof item.confidence === 'number' ? { confidence: item.confidence } : {}),
      }]
    })
    return { reason: text(raw.reason, 'Projected event evidence.'), changes }
  }

  private async callJson(system: string, payload: unknown): Promise<unknown> {
    const session = this.sessions.getStore()
    if (!session) throw new Error('StrataGate model callback ran without a DSH session')
    const route = this.resolveRoute(session)
    const message = createUserMessage({
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      source: { kind: 'plugin', plugin: 'stratagate-memory' },
    })
    const assembler = new BlockAssembler()
    for await (const chunk of this.ctx.llm.stream({
      ...route,
      messages: [message],
      system,
      maxTokens: this.config.maxOutputTokens,
      sessionId: session.id,
      purpose: 'compaction',
    })) assembler.push(chunk)
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      throw new Error(`StrataGate model call failed: ${finish.failure.message}`)
    }
    const response = assembler.blocks()
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('')
    return parseJsonResponse(response)
  }

  private resolveRoute(session: Session): { provider: string; model: string; reasoningEffort?: never } {
    if (this.config.provider && this.config.model) {
      return { provider: this.config.provider, model: this.config.model }
    }
    const request = session.requestHeader()?.config
    if (request) return { provider: request.provider, model: request.model }
    const fallback = this.ctx.agentDefaultModel.currentSelection()
    return { provider: fallback.provider, model: fallback.model }
  }
}
