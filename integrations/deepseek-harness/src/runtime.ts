import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  StrataGate,
  type ElementSearchOptions,
  type MemoryElementType,
  type RetrievalAssessmentInput,
  type SearchOptions,
} from '@diqier/stratagate'
import type { ResolvedConfig } from './config.js'
import { TurnFolder } from './fold.js'
import { DshModelBridge } from './llm.js'

interface EvidenceTarget {
  eventIds: string[]
  elementIds: string[]
}

interface RetrievalBatch {
  id: string
  refs: Map<string, EvidenceTarget>
}

function projectKey(cwd: string | undefined): string {
  const canonical = resolve(cwd ?? process.cwd()).replaceAll('\\', '/').toLowerCase()
  return createHash('sha256').update(canonical).digest('hex').slice(0, 20)
}

export class StrataGateRuntime {
  private readonly folder = new TurnFolder()
  private readonly spaces = new Map<string, Promise<StrataGate>>()
  private readonly batches = new Map<string, RetrievalBatch>()
  private readonly adopted = new Map<string, EvidenceTarget>()
  private ingestTail: Promise<void> = Promise.resolve()
  private batchSequence = 0
  private closed = false
  private ingestError: unknown

  constructor(
    private readonly config: ResolvedConfig,
    private readonly models: DshModelBridge,
    private readonly onIngestError: (error: unknown) => void = () => {},
  ) {}

  acceptEvent(session: Session, event: SessionEvent): void {
    if (this.closed) return
    if (!this.config.ingestSubagents && session.header.origin === 'subagent') return
    const turn = this.folder.accept(session, event)
    if (!turn) return
    this.ingestTail = this.ingestTail.catch(() => {}).then(async () => {
      const memory = await this.space(session)
      await this.models.run(session, () => memory.appendTurn(turn))
    }).catch((error: unknown) => {
      this.ingestError = error
      this.onIngestError(error)
    })
  }

  async searchEvents(session: Session, query: string, options: SearchOptions = {}): Promise<unknown> {
    await this.flush()
    const results = await (await this.space(session)).searchEvents(query, options)
    return this.batch(session, results.map(({ event }) => ({
      ref: `event:${event.id}`,
      target: { eventIds: [event.id], elementIds: [] },
    })), results)
  }

  async searchElements(session: Session, query: string, options: ElementSearchOptions = {}): Promise<unknown> {
    await this.flush()
    const results = await (await this.space(session)).searchElements(query, options)
    return this.batch(session, results.map((result) => ({
      ref: `element:${result.elementId}:fact:${result.id}`,
      target: { eventIds: result.fact.sourceEventIds, elementIds: [result.elementId] },
    })), results)
  }

  async searchRaw(session: Session, query: string, limit?: number): Promise<unknown> {
    await this.flush()
    const results = (await this.space(session)).searchRawMemory(query, limit)
    return this.batch(session, results.map((result, index) => ({
      ref: `raw:${result.blockId}:${result.message.id}:${index}`,
      target: { eventIds: [], elementIds: [] },
    })), results)
  }

  async blocks(session: Session): Promise<unknown> {
    await this.flush()
    const results = (await this.space(session)).getBlockContext()
    return this.batch(session, results.map((result) => ({
      ref: `block:${result.id}:level:${result.level}`,
      target: { eventIds: [], elementIds: [] },
    })), results)
  }

  async expandBlock(session: Session, id: string, target?: string | number): Promise<unknown> {
    await this.flush()
    const result = await (await this.space(session)).expandBlock(id, target)
    return this.batch(session, [{
      ref: `block:${result.id}:level:${result.level}`,
      target: { eventIds: [], elementIds: [] },
    }], result)
  }

  async expandElement(session: Session, id: string, at?: string): Promise<unknown> {
    await this.flush()
    const result = (await this.space(session)).expandElement(id, at)
    return this.batch(session, [{
      ref: `element:${result.id}`,
      target: { eventIds: result.sourceEventIds, elementIds: [result.id] },
    }], result)
  }

  async expandEvent(session: Session, id: string): Promise<unknown> {
    await this.flush()
    const event = (await this.space(session)).listEvents().find((candidate) => candidate.id === id)
    if (!event) throw new Error(`Unknown event: ${id}`)
    return this.batch(session, [{
      ref: `event:${event.id}`,
      target: { eventIds: [event.id], elementIds: [] },
    }], event)
  }

  async assess(session: Session, input: RetrievalAssessmentInput): Promise<unknown> {
    const key = String(session.id)
    const batch = this.batches.get(key)
    if (!batch) throw new Error('No StrataGate retrieval batch exists for this session')
    const memory = await this.space(session)
    const assessment = memory.assessRetrieval(input, new Set(batch.refs.keys()))
    if (assessment.verdict === 'sufficient') {
      const eventIds = new Set<string>()
      const elementIds = new Set<string>()
      for (const ref of assessment.evidenceRefs) {
        const target = batch.refs.get(ref)
        for (const id of target?.eventIds ?? []) eventIds.add(id)
        for (const id of target?.elementIds ?? []) elementIds.add(id)
      }
      this.adopted.set(key, { eventIds: [...eventIds], elementIds: [...elementIds] })
    } else {
      this.adopted.delete(key)
    }
    return { batchId: batch.id, ...assessment }
  }

  async recordUse(session: Session, receiptId: string): Promise<unknown> {
    const key = String(session.id)
    const refs = this.adopted.get(key)
    if (!refs) throw new Error('No sufficient StrataGate evidence has been assessed for this session')
    await (await this.space(session)).recordMemoryUse(refs, { receiptId: `dsh:${key}:tool:${receiptId}` })
    this.adopted.delete(key)
    return { recorded: true, eventIds: refs.eventIds, elementIds: refs.elementIds }
  }

  async flush(): Promise<void> {
    await this.ingestTail
    if (this.ingestError !== undefined) {
      const error = this.ingestError
      this.ingestError = undefined
      throw error
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    let flushError: unknown
    try {
      await this.flush()
    } catch (error) {
      flushError = error
    }
    const settled = await Promise.allSettled(this.spaces.values())
    await Promise.all(settled.flatMap((result) => result.status === 'fulfilled' ? [result.value.close()] : []))
    if (flushError !== undefined) throw flushError
  }

  namespaceFor(session: Session): string {
    const prefix = this.config.namespacePrefix
    if (this.config.namespaceMode === 'global') return `${prefix}:global:${this.config.globalNamespace}`
    if (this.config.namespaceMode === 'session') return `${prefix}:session:${String(session.id)}`
    return `${prefix}:project:${projectKey(session.header.cwd)}`
  }

  private space(session: Session): Promise<StrataGate> {
    const namespace = this.namespaceFor(session)
    let opening = this.spaces.get(namespace)
    if (!opening) {
      opening = StrataGate.open({
        database: this.config.database,
        namespace,
        blockTurnSize: this.config.blockTurnSize,
        summarizer: this.models.summarizer,
        extractor: this.models.extractor,
        elementProjector: this.models.projector,
      }).then(async (memory) => {
        await this.models.run(session, () => memory.resumePendingWork())
        return memory
      })
      this.spaces.set(namespace, opening)
    }
    return opening
  }

  private batch(
    session: Session,
    evidence: Array<{ ref: string; target: EvidenceTarget }>,
    results: unknown,
  ): unknown {
    const id = `batch_${++this.batchSequence}`
    const refs = new Map(evidence.map(({ ref, target }) => [ref, target]))
    this.batches.set(String(session.id), { id, refs })
    this.adopted.delete(String(session.id))
    return { batchId: id, evidenceRefs: [...refs.keys()], results }
  }
}

export function elementType(value: string | undefined): MemoryElementType | undefined {
  return value === 'person' || value === 'project' || value === 'organization' || value === 'tool' || value === 'place'
    ? value
    : undefined
}
