import type { Context } from '@deepseek-ai/cordis'
import type { ElementCard, EventCard, RawMessage, StrataGateSnapshot, UsageReceipt } from '@diqier/stratagate'
import type { StrataGateRuntime } from './runtime.js'

export interface WebResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body: string): void
}

export interface WebRequest {
  method?: string
  url?: string
}

export interface WebServerLike {
  register(route: {
    readonly kind: 'prefix'
    readonly path: string
    readonly handler: (req: WebRequest, res: WebResponse) => Promise<void>
  }): () => void
}

function sendJson(res: WebResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(redactValue(body)))
}

function numeric(value: string | null, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.floor(parsed))) : fallback
}

function redact(text: string): string {
  return text
    .replace(/\b(?:sk|gh[opasu]|github_pat)_[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}={0,2}\b/gi, '$1[REDACTED]')
    .replace(/\b(api[_-]?key|token|password|secret)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)]))
  }
  return value
}

function redactedMessage(message: RawMessage, blockId: string | null): RawMessage & { blockId: string | null } {
  const { toolCalls, ...base } = message
  const common = { ...base, content: redact(message.content), blockId }
  return toolCalls
    ? { ...common, toolCalls: redactValue(toolCalls) as NonNullable<RawMessage['toolCalls']> }
    : common
}

function sourceMessages(snapshot: StrataGateSnapshot, ids?: ReadonlySet<string>): Array<RawMessage & { blockId: string | null }> {
  const output: Array<RawMessage & { blockId: string | null }> = []
  for (const block of snapshot.blocks) {
    for (const message of block.l5Raw) {
      if (!ids || ids.has(message.id)) {
        output.push(redactedMessage(message, block.id))
      }
    }
  }
  for (const message of snapshot.openTail) {
    if (!ids || ids.has(message.id)) {
      output.push(redactedMessage(message, null))
    }
  }
  return output
}

function eventSummary(event: EventCard): unknown {
  return {
    id: event.id,
    title: event.title,
    summary: event.summary,
    tags: event.tags,
    sourceBlockId: event.sourceBlockId,
    sourceMessageIds: event.sourceMessageIds,
    temporal: event.temporal,
    scope: event.scope,
    criticality: event.criticality,
    confidence: event.confidence,
    status: event.status,
    supersededBy: event.supersededBy,
    weight: event.weight,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  }
}

function elementSummary(element: ElementCard): unknown {
  return {
    id: element.id,
    name: element.name,
    type: element.type,
    aliases: element.aliases,
    currentState: element.currentState,
    facts: element.facts,
    sourceEventIds: element.sourceEventIds,
    sourceMessageIds: element.sourceMessageIds,
    weight: element.weight,
    createdAt: element.createdAt,
    updatedAt: element.updatedAt,
  }
}

function matchesQuery(value: unknown, query: string): boolean {
  if (!query) return true
  return JSON.stringify(value).toLocaleLowerCase().includes(query.toLocaleLowerCase())
}

async function requiredSnapshot(runtime: StrataGateRuntime, namespace: string): Promise<StrataGateSnapshot> {
  const snapshot = await runtime.adminSnapshot(namespace)
  if (!snapshot) throw new AdminHttpError(404, `Unknown StrataGate namespace: ${namespace}`)
  return snapshot
}

class AdminHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function overview(runtime: StrataGateRuntime): Promise<unknown> {
  const namespaces = await runtime.adminNamespaces()
  const rows = []
  for (const namespace of namespaces) {
    const snapshot = await runtime.adminSnapshot(namespace)
    if (!snapshot) continue
    const failedJobs = snapshot.extractionJobs.filter(({ status }) => status === 'failed').length
      + snapshot.elementProjectionJobs.filter(({ status }) => status === 'failed').length
    const timestamps = [
      ...snapshot.blocks.map(({ createdAt }) => createdAt),
      ...snapshot.events.map(({ updatedAt }) => updatedAt),
      ...snapshot.elements.map(({ updatedAt }) => updatedAt),
      ...snapshot.usageReceipts.map(({ createdAt }) => createdAt),
    ].sort()
    rows.push({
      namespace,
      schemaVersion: snapshot.schemaVersion,
      currentTurn: snapshot.currentTurn,
      blockTurnSize: snapshot.blockTurnSize,
      blocks: snapshot.blocks.length,
      openTailMessages: snapshot.openTail.length,
      events: snapshot.events.length,
      activeEvents: snapshot.events.filter(({ status }) => status === 'active').length,
      elements: snapshot.elements.length,
      usageReceipts: snapshot.usageReceipts.length,
      failedJobs,
      lastActivityAt: timestamps.at(-1) ?? null,
    })
  }
  return { readonly: true, namespaces: rows }
}

async function memories(runtime: StrataGateRuntime, url: URL): Promise<unknown> {
  const namespace = url.searchParams.get('namespace')?.trim() ?? ''
  if (!namespace) throw new AdminHttpError(400, 'namespace is required')
  const snapshot = await requiredSnapshot(runtime, namespace)
  const kind = url.searchParams.get('kind') ?? 'events'
  const query = url.searchParams.get('q')?.trim() ?? ''
  const offset = numeric(url.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER)
  const limit = numeric(url.searchParams.get('limit'), 100, 1, 200)
  let values: unknown[]
  if (kind === 'events') values = snapshot.events.map(eventSummary)
  else if (kind === 'elements') values = snapshot.elements.map(elementSummary)
  else if (kind === 'blocks') values = snapshot.blocks.map((block) => ({
    id: block.id,
    sequence: block.sequence,
    turnRange: [block.startTurn, block.endTurn],
    title: block.l0Title,
    tags: block.l0Tags,
    summary: block.l1Summary,
    keypoints: block.l2Keypoints,
    currentLevel: block.pointerCurrentLevel,
    sourceMessages: block.l5Raw.length,
    createdAt: block.createdAt,
  }))
  else throw new AdminHttpError(400, `Unsupported memory kind: ${kind}`)
  const filtered = values.filter((value) => matchesQuery(value, query))
  return { namespace, kind, total: filtered.length, offset, limit, items: filtered.slice(offset, offset + limit) }
}

async function sources(runtime: StrataGateRuntime, url: URL): Promise<unknown> {
  const namespace = url.searchParams.get('namespace')?.trim() ?? ''
  if (!namespace) throw new AdminHttpError(400, 'namespace is required')
  const snapshot = await requiredSnapshot(runtime, namespace)
  const eventId = url.searchParams.get('eventId')
  const elementId = url.searchParams.get('elementId')
  const blockId = url.searchParams.get('blockId')
  let events: EventCard[] = []
  let elements: ElementCard[] = []
  let ids = new Set<string>()
  if (eventId) {
    const event = snapshot.events.find(({ id }) => id === eventId)
    if (!event) throw new AdminHttpError(404, `Unknown event: ${eventId}`)
    events = [event]
    ids = new Set(event.sourceMessageIds)
  } else if (elementId) {
    const element = snapshot.elements.find(({ id }) => id === elementId)
    if (!element) throw new AdminHttpError(404, `Unknown element: ${elementId}`)
    elements = [element]
    events = snapshot.events.filter(({ id }) => element.sourceEventIds.includes(id))
    ids = new Set(events.flatMap(({ sourceMessageIds }) => sourceMessageIds))
  } else if (blockId) {
    const block = snapshot.blocks.find(({ id }) => id === blockId)
    if (!block) throw new AdminHttpError(404, `Unknown block: ${blockId}`)
    ids = new Set(block.l5Raw.map(({ id }) => id))
    events = snapshot.events.filter(({ sourceBlockId }) => sourceBlockId === blockId)
  } else {
    throw new AdminHttpError(400, 'eventId, elementId, or blockId is required')
  }
  return {
    namespace,
    events: events.map(eventSummary),
    elements: elements.map(elementSummary),
    messages: sourceMessages(snapshot, ids),
  }
}

function receiptSources(snapshot: StrataGateSnapshot, receipt: UsageReceipt): unknown {
  const events = snapshot.events.filter(({ id }) => receipt.eventIds.includes(id))
  const elements = snapshot.elements.filter(({ id }) => receipt.elementIds.includes(id))
  const eventIds = new Set([...receipt.eventIds, ...elements.flatMap(({ sourceEventIds }) => sourceEventIds)])
  const supportingEvents = snapshot.events.filter(({ id }) => eventIds.has(id))
  const messageIds = new Set(supportingEvents.flatMap(({ sourceMessageIds }) => sourceMessageIds))
  return {
    ...receipt,
    events: events.map(eventSummary),
    elements: elements.map(elementSummary),
    sourceMessages: sourceMessages(snapshot, messageIds),
  }
}

async function audit(runtime: StrataGateRuntime, url: URL): Promise<unknown> {
  const namespace = url.searchParams.get('namespace')?.trim() ?? ''
  if (!namespace) throw new AdminHttpError(400, 'namespace is required')
  const snapshot = await requiredSnapshot(runtime, namespace)
  const offset = numeric(url.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER)
  const limit = numeric(url.searchParams.get('limit'), 50, 1, 100)
  const receipts = [...snapshot.usageReceipts].reverse()
  return {
    namespace,
    total: receipts.length,
    offset,
    limit,
    items: receipts.slice(offset, offset + limit).map((receipt) => receiptSources(snapshot, receipt)),
  }
}

export async function handleAdminRequest(runtime: StrataGateRuntime, req: WebRequest, res: WebResponse): Promise<void> {
  try {
    if (req.method !== 'GET') throw new AdminHttpError(405, 'StrataGate Memory UI is read-only')
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/\/$/, '')
    if (path === '/api/stratagate/overview') sendJson(res, 200, await overview(runtime))
    else if (path === '/api/stratagate/memories') sendJson(res, 200, await memories(runtime, url))
    else if (path === '/api/stratagate/sources') sendJson(res, 200, await sources(runtime, url))
    else if (path === '/api/stratagate/audit') sendJson(res, 200, await audit(runtime, url))
    else throw new AdminHttpError(404, 'Unknown StrataGate admin route')
  } catch (error) {
    const status = error instanceof AdminHttpError ? error.status : 500
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, status, { error: message })
  }
}

export function registerAdminRoutes(ctx: Context, runtime: StrataGateRuntime): (() => void) | undefined {
  const webServer = ctx.get('webServer') as WebServerLike | undefined
  if (!webServer) return undefined
  return webServer.register({
    kind: 'prefix',
    path: '/api/stratagate',
    handler: (req, res) => handleAdminRequest(runtime, req, res),
  })
}
