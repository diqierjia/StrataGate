import {
  DEFAULT_BLOCK_TURN_SIZE,
  blockLevelLabel,
  deterministicBlockLayers,
  getDecayedBlockLevel,
  normalizeBlockLevel,
} from './blocks.js';
import { applyElementChanges, elementViewAt } from './elements.js';
import { normalizeRetrievalAssessment, type RetrievalAssessment, type RetrievalAssessmentInput } from './retrieval.js';
import { SqliteStorage } from './sqlite.js';
import {
  bm25Rank,
  fuzzySearchMatch,
  normalizeSearchText,
  rrfRank,
  searchTokens,
  weightedSearchTokens,
} from './search.js';
import {
  STRATAGATE_STORAGE_SCHEMA_VERSION,
  cloneSnapshot,
  normalizeSnapshot,
  type ElementProjectionJob,
  type ExtractionJob,
  type IngestionReceipt,
  type StorageAdapter,
  type StrataGateSnapshot,
  type UsageReceipt,
} from './storage.js';
import type {
  AppendTurnResult,
  BlockLevel,
  BlockSummarizer,
  ElementCard,
  ElementProjectionContext,
  ElementProjectionResult,
  ElementProjector,
  ElementSearchOptions,
  ElementSearchResult,
  EventCard,
  EventCardInput,
  EventExtractor,
  EventSearchResult,
  MemoryBlock,
  RawMessage,
  RawSearchHit,
  SearchOptions,
  ToolTrace,
} from './types.js';
import { criticalityFloor, memoryWeightAt } from './weights.js';

export interface StrataGateOptions {
  blockTurnSize?: number;
  summarizer?: BlockSummarizer;
  extractor?: EventExtractor;
  elementProjector?: ElementProjector;
  now?: () => Date;
  idFactory?: (prefix: 'msg' | 'blk' | 'evt') => string;
  elementIdFactory?: (prefix: 'elem' | 'fact' | 'proj') => string;
}

export interface PersistentStrataGateOptions extends StrataGateOptions {
  storage: StorageAdapter;
  namespace: string;
}

export interface SqliteStrataGateOptions extends StrataGateOptions {
  database: string;
  namespace: string;
  timeoutMs?: number;
}

export interface TurnInput {
  user: string;
  assistant: string;
  createdAt?: string;
  userToolCalls?: ToolTrace[];
  assistantToolCalls?: ToolTrace[];
  receiptId?: string;
}

export interface BlockContextEntry {
  id: string;
  turnRange: [number, number];
  level: BlockLevel;
  label: string;
  content: string;
}

export interface RecordMemoryUseOptions {
  receiptId?: string;
}

export interface MemoryUseRefs {
  eventIds?: readonly string[];
  elementIds?: readonly string[];
}

export interface ResumePendingResult {
  sealedBlocks: MemoryBlock[];
  extractedEvents: EventCard[];
  projectedElements: ElementCard[];
}

function defaultIdFactory(prefix: 'msg' | 'blk' | 'evt'): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function defaultElementIdFactory(prefix: 'elem' | 'fact' | 'proj'): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function defaultSummary(messages: readonly RawMessage[]): {
  l0Title: string;
  l0Tags: string[];
  l1Summary: string;
  l2Keypoints: string[];
  shouldExtract: boolean;
} {
  const natural = messages.filter((message) => message.role === 'user' || message.role === 'assistant');
  const firstUser = natural.find((message) => message.role === 'user');
  return {
    l0Title: (firstUser?.content ?? 'Conversation block').replace(/\s+/g, ' ').trim().slice(0, 80),
    l0Tags: [],
    l1Summary: natural.slice(0, 4).map((message) => message.content.replace(/\s+/g, ' ').trim()).join(' ').slice(0, 500),
    l2Keypoints: natural.slice(0, 8).map((message) => message.content.replace(/\s+/g, ' ').trim().slice(0, 160)),
    shouldExtract: false,
  };
}

function renderBlock(block: MemoryBlock, level: BlockLevel): string {
  if (level === 0) return `${block.l0Title}\nTags: ${block.l0Tags.join(', ') || 'none'}`;
  if (level === 1) return block.l1Summary || block.l0Title;
  if (level === 2) return block.l2Keypoints.map((point) => `- ${point}`).join('\n') || block.l1Summary;
  if (level === 3) return block.l3Condensed;
  if (level === 4) return block.l4Readable;
  return block.l5Raw.map((message) => `${message.role}: ${message.content}`).join('\n\n');
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

const STRATAGATE_CONSTRUCTOR_TOKEN = Symbol('StrataGate constructor');

export class StrataGate {
  readonly blockTurnSize: number;

  private readonly summarizer: BlockSummarizer | undefined;
  private readonly extractor: EventExtractor | undefined;
  private readonly elementProjector: ElementProjector | undefined;
  private readonly now: () => Date;
  private readonly idFactory: (prefix: 'msg' | 'blk' | 'evt') => string;
  private readonly elementIdFactory: (prefix: 'elem' | 'fact' | 'proj') => string;
  private readonly openTail: RawMessage[] = [];
  private readonly blocks: MemoryBlock[] = [];
  private readonly events: EventCard[] = [];
  private readonly elements: ElementCard[] = [];
  private readonly extractionJobs = new Map<string, ExtractionJob>();
  private readonly elementProjectionJobs = new Map<string, ElementProjectionJob>();
  private readonly usageReceipts = new Map<string, UsageReceipt>();
  private readonly ingestionReceipts = new Map<string, IngestionReceipt>();
  private currentTurn = 0;
  private storage: StorageAdapter | undefined;
  private namespace: string | undefined;
  private revision = 0;
  private mutationQueue: Promise<void> = Promise.resolve();

  private constructor(options: StrataGateOptions, token: symbol) {
    if (token !== STRATAGATE_CONSTRUCTOR_TOKEN) {
      throw new TypeError('Use StrataGate.open() for SQLite or StrataGate.inMemory() for explicit ephemeral storage');
    }
    this.blockTurnSize = Math.max(1, Math.floor(options.blockTurnSize ?? DEFAULT_BLOCK_TURN_SIZE));
    this.summarizer = options.summarizer;
    this.extractor = options.extractor;
    this.elementProjector = options.elementProjector;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.elementIdFactory = options.elementIdFactory ?? defaultElementIdFactory;
  }

  static inMemory(options: StrataGateOptions = {}): StrataGate {
    return new StrataGate(options, STRATAGATE_CONSTRUCTOR_TOKEN);
  }

  static async open(options: SqliteStrataGateOptions): Promise<StrataGate> {
    const database = options.database.trim();
    if (!database) throw new TypeError('SQLite database path must not be empty');
    const storage = new SqliteStorage({
      filename: database,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
    try {
      return await StrataGate.openWithStorage({
        storage,
        namespace: options.namespace,
        ...(options.blockTurnSize !== undefined ? { blockTurnSize: options.blockTurnSize } : {}),
        ...(options.summarizer ? { summarizer: options.summarizer } : {}),
        ...(options.extractor ? { extractor: options.extractor } : {}),
        ...(options.elementProjector ? { elementProjector: options.elementProjector } : {}),
        ...(options.now ? { now: options.now } : {}),
        ...(options.idFactory ? { idFactory: options.idFactory } : {}),
        ...(options.elementIdFactory ? { elementIdFactory: options.elementIdFactory } : {}),
      });
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  static async openWithStorage(options: PersistentStrataGateOptions): Promise<StrataGate> {
    const namespace = options.namespace.trim();
    if (!namespace) throw new TypeError('Storage namespace must not be empty');
    const loaded = await options.storage.load(namespace);
    const loadedSnapshot = loaded ? normalizeSnapshot(loaded.snapshot) : null;
    if (loaded && options.blockTurnSize !== undefined) {
      const requested = Math.max(1, Math.floor(options.blockTurnSize));
      if (requested !== loadedSnapshot?.blockTurnSize) {
        throw new Error(`Stored blockTurnSize is ${loadedSnapshot?.blockTurnSize}, but ${requested} was requested`);
      }
    }
    const memoryOptions: StrataGateOptions = {};
    if (loadedSnapshot) memoryOptions.blockTurnSize = loadedSnapshot.blockTurnSize;
    else if (options.blockTurnSize !== undefined) memoryOptions.blockTurnSize = options.blockTurnSize;
    if (options.summarizer) memoryOptions.summarizer = options.summarizer;
    if (options.extractor) memoryOptions.extractor = options.extractor;
    if (options.elementProjector) memoryOptions.elementProjector = options.elementProjector;
    if (options.now) memoryOptions.now = options.now;
    if (options.idFactory) memoryOptions.idFactory = options.idFactory;
    if (options.elementIdFactory) memoryOptions.elementIdFactory = options.elementIdFactory;
    const memory = new StrataGate(memoryOptions, STRATAGATE_CONSTRUCTOR_TOKEN);
    memory.storage = options.storage;
    memory.namespace = namespace;
    if (loaded && loadedSnapshot) {
      memory.restoreSnapshot(loadedSnapshot);
      memory.revision = loaded.revision;
      const interrupted = [...memory.extractionJobs.values()].filter((job) => job.status === 'running');
      if (interrupted.length > 0) {
        await memory.commitMutation(() => {
          const now = memory.now().toISOString();
          for (const job of interrupted) {
            memory.extractionJobs.set(job.blockId, {
              ...job,
              status: 'failed',
              lastError: 'Extraction was interrupted before completion.',
              updatedAt: now,
            });
          }
        });
      }
      const interruptedProjections = [...memory.elementProjectionJobs.values()]
        .filter((job) => job.status === 'running');
      if (interruptedProjections.length > 0) {
        await memory.commitMutation(() => {
          const now = memory.now().toISOString();
          for (const job of interruptedProjections) {
            memory.elementProjectionJobs.set(job.id, {
              ...job,
              status: 'failed',
              lastError: 'Element projection was interrupted before completion.',
              updatedAt: now,
            });
          }
        });
      }
    } else {
      await memory.persist();
    }
    return memory;
  }

  get turn(): number {
    return this.currentTurn;
  }

  get storageRevision(): number {
    return this.revision;
  }

  listBlocks(): readonly MemoryBlock[] {
    return this.blocks;
  }

  listEvents(): readonly EventCard[] {
    return this.events;
  }

  listElements(): readonly ElementCard[] {
    return this.elements;
  }

  listOpenTail(): readonly RawMessage[] {
    return this.openTail;
  }

  listExtractionJobs(): readonly ExtractionJob[] {
    return [...this.extractionJobs.values()];
  }

  listElementProjectionJobs(): readonly ElementProjectionJob[] {
    return [...this.elementProjectionJobs.values()];
  }

  exportSnapshot(): StrataGateSnapshot {
    return cloneSnapshot({
      schemaVersion: STRATAGATE_STORAGE_SCHEMA_VERSION,
      currentTurn: this.currentTurn,
      blockTurnSize: this.blockTurnSize,
      openTail: this.openTail,
      blocks: this.blocks,
      events: this.events,
      elements: this.elements,
      extractionJobs: [...this.extractionJobs.values()],
      elementProjectionJobs: [...this.elementProjectionJobs.values()],
      usageReceipts: [...this.usageReceipts.values()],
      ingestionReceipts: [...this.ingestionReceipts.values()],
    });
  }

  hasIngestionReceipt(receiptId: string): boolean {
    return this.ingestionReceipts.has(receiptId.trim());
  }

  async appendTurn(input: TurnInput): Promise<AppendTurnResult> {
    const receiptId = input.receiptId?.trim();
    if (input.receiptId !== undefined && !receiptId) {
      throw new TypeError('Turn receiptId must not be empty');
    }
    const createdAt = input.createdAt ?? this.now().toISOString();
    const userMessage: RawMessage = {
      id: this.idFactory('msg'),
      role: 'user',
      content: input.user,
      createdAt,
      ...(input.userToolCalls ? { toolCalls: input.userToolCalls } : {}),
    };
    const assistantMessage: RawMessage = {
      id: this.idFactory('msg'),
      role: 'assistant',
      content: input.assistant,
      createdAt,
      ...(input.assistantToolCalls ? { toolCalls: input.assistantToolCalls } : {}),
    };
    const appended = await this.commitMutation(() => {
      if (receiptId && this.ingestionReceipts.has(receiptId)) return false;
      this.currentTurn += 1;
      this.openTail.push(userMessage, assistantMessage);
      if (receiptId) this.ingestionReceipts.set(receiptId, { id: receiptId, createdAt });
      return true;
    });
    if (!appended) return { sealedBlock: null, extractedEvents: [], projectedElements: [] };

    if (this.openTail.filter((message) => message.role === 'user').length < this.blockTurnSize) {
      const projectedElements = await this.projectEligibleElements() ?? [];
      return { sealedBlock: null, extractedEvents: [], projectedElements };
    }

    const sealedBlock = await this.sealOpenTail();
    const extractedEvents = await this.extractEligibleBlock() ?? [];
    const projectedElements = await this.projectEligibleElements() ?? [];
    return { sealedBlock, extractedEvents, projectedElements };
  }

  async resumePendingWork(): Promise<ResumePendingResult> {
    const sealedBlocks: MemoryBlock[] = [];
    const extractedEvents: EventCard[] = [];
    const projectedElements: ElementCard[] = [];
    while (this.openTail.filter((message) => message.role === 'user').length >= this.blockTurnSize) {
      sealedBlocks.push(await this.sealOpenTail());
      extractedEvents.push(...(await this.extractEligibleBlock() ?? []));
      projectedElements.push(...(await this.projectEligibleElements() ?? []));
    }
    while (true) {
      const extracted = await this.extractEligibleBlock();
      if (extracted === null) break;
      extractedEvents.push(...extracted);
      projectedElements.push(...(await this.projectEligibleElements() ?? []));
    }
    while (true) {
      const projected = await this.projectEligibleElements();
      if (projected === null) break;
      projectedElements.push(...projected);
    }
    return { sealedBlocks, extractedEvents, projectedElements };
  }

  async addEvent(input: EventCardInput): Promise<EventCard> {
    return this.commitMutation(() => {
      const event = this.addEventInMemory(input);
      this.queueElementProjection([event.id]);
      return event;
    });
  }

  async searchEvents(query: string, options: SearchOptions = {}): Promise<EventSearchResult[]> {
    const limit = Math.max(1, Math.min(20, options.limit ?? 6));
    const participants = (options.participants ?? []).map(normalizeSearchText).filter(Boolean);
    const eventType = normalizeSearchText(options.eventType ?? '');
    const from = options.happenedFrom ? Date.parse(options.happenedFrom) : Number.NEGATIVE_INFINITY;
    const to = options.happenedTo ? Date.parse(options.happenedTo) : Number.POSITIVE_INFINITY;
    const hasTimeFilter = Boolean(options.happenedFrom || options.happenedTo);
    const candidates = this.events.filter((event) => event.status === 'active' || event.status === 'superseded');
    const participantMatches = candidates.filter((event) => participants.length > 0 && participants.every((person) =>
      (event.temporal.participants ?? []).some((candidate) => fuzzySearchMatch(candidate, person))));
    const typeMatches = eventType ? candidates.filter((event) =>
      fuzzySearchMatch(event.temporal.eventType ?? '', eventType)
      || fuzzySearchMatch(`${event.title} ${event.summary} ${event.tags.join(' ')}`, eventType)) : [];
    const timeMatches = hasTimeFilter ? candidates.filter((event) => {
      const start = Date.parse(event.temporal.happenedStart ?? event.temporal.happenedEnd ?? '');
      const end = Date.parse(event.temporal.happenedEnd ?? event.temporal.happenedStart ?? '');
      return Number.isFinite(start) && Number.isFinite(end) && start <= to && end >= from;
    }) : [];
    const bm25 = bm25Rank(candidates, query, (event) => weightedSearchTokens([
      [event.title, 4],
      [event.summary, 3],
      [event.tags.join(' '), 2],
      [event.quotes.join(' '), 2],
      [event.narrative, 1],
      [(event.temporal.participants ?? []).join(' '), 5],
      [event.temporal.eventType ?? '', 5],
      [event.temporal.originalText ?? '', 4],
      [`${event.temporal.happenedStart ?? ''} ${event.temporal.happenedEnd ?? ''}`, 4],
    ])).map(({ item }) => item);
    const chronology = (event: EventCard): string => event.temporal.happenedStart
      ?? event.temporal.happenedEnd
      ?? event.temporal.mentionedAt
      ?? event.createdAt;
    const structured = (items: readonly EventCard[]): EventCard[] => [...items].sort((left, right) => {
      if (options.temporalIntent === 'first') return chronology(left).localeCompare(chronology(right));
      if (options.temporalIntent === 'latest') return chronology(right).localeCompare(chronology(left));
      return memoryWeightAt(right, this.currentTurn) - memoryWeightAt(left, this.currentTurn)
        || right.updatedAt.localeCompare(left.updatedAt);
    });
    const participantIds = new Set(participantMatches.map(({ id }) => id));
    const typeIds = new Set(typeMatches.map(({ id }) => id));
    const timeIds = new Set(timeMatches.map(({ id }) => id));
    const hasStructuredFilter = participants.length > 0 || Boolean(eventType) || hasTimeFilter;
    const exactStructuredMatches = hasStructuredFilter ? candidates.filter((event) =>
      (participants.length === 0 || participantIds.has(event.id))
      && (!eventType || typeIds.has(event.id))
      && (!hasTimeFilter || timeIds.has(event.id))) : [];
    const rankings: EventCard[][] = [];
    if (exactStructuredMatches.length > 0) {
      const exactIds = new Set(exactStructuredMatches.map(({ id }) => id));
      rankings.push(bm25.filter(({ id }) => exactIds.has(id)), structured(exactStructuredMatches));
    } else {
      rankings.push(bm25);
      if (participantMatches.length > 0) rankings.push(structured(participantMatches));
      if (typeMatches.length > 0) rankings.push(structured(typeMatches));
      if (timeMatches.length > 0) rankings.push(structured(timeMatches));
    }
    if (searchTokens(query).length > 0 && bm25.length === 0 && !hasStructuredFilter) return [];
    if (!rankings.some((ranking) => ranking.length > 0)) {
      if (searchTokens(query).length > 0) return [];
      rankings.push(structured(candidates));
    }
    const ranked = rrfRank(rankings).slice(0, limit).map(({ item: event, score }) => ({ event, score }));
    if (ranked.length > 0) {
      const now = this.now().toISOString();
      await this.commitMutation(() => {
        for (const { event } of ranked) event.weight.lastRetrievedAt = now;
      });
    }
    return ranked;
  }

  async claimNextElementProjection(): Promise<ElementProjectionContext | null> {
    return this.commitMutation(() => {
      const job = [...this.elementProjectionJobs.values()]
        .find((candidate) => candidate.status === 'pending' || candidate.status === 'failed');
      if (!job) return null;
      const events = job.sourceEventIds.flatMap((id) => this.events.find((event) => event.id === id) ?? []);
      if (events.length === 0) {
        throw new Error(`Element projection ${job.id} has no available source events`);
      }
      job.status = 'running';
      job.attempts += 1;
      job.lastError = null;
      job.updatedAt = this.now().toISOString();
      return {
        jobId: job.id,
        events: structuredClone(events),
        existingElements: structuredClone(this.elements),
      };
    });
  }

  async completeElementProjection(jobId: string, result: ElementProjectionResult): Promise<ElementCard[]> {
    return this.commitMutation(() => {
      const job = this.requireElementProjectionJob(jobId);
      if (job.status === 'completed') {
        return job.elementIds.flatMap((id) => this.elements.find((element) => element.id === id) ?? []);
      }
      if (job.status !== 'running') throw new Error(`Element projection ${job.id} is ${job.status}, not running`);
      const touched = applyElementChanges({
        elements: this.elements,
        events: this.events,
        changes: Array.isArray(result.changes) ? result.changes : [],
        allowedEventIds: new Set(job.sourceEventIds),
        now: this.now().toISOString(),
        currentTurn: this.currentTurn,
        idFactory: this.elementIdFactory,
      });
      job.status = 'completed';
      job.elementIds = touched.map(({ id }) => id);
      job.reason = typeof result.reason === 'string'
        ? result.reason.trim().replace(/\s+/g, ' ').slice(0, 500) || null
        : null;
      job.lastError = null;
      job.updatedAt = this.now().toISOString();
      return touched;
    });
  }

  async failElementProjection(jobId: string, error: unknown): Promise<void> {
    await this.commitMutation(() => {
      const job = this.requireElementProjectionJob(jobId);
      if (job.status === 'completed') return;
      job.status = 'failed';
      job.lastError = errorMessage(error);
      job.updatedAt = this.now().toISOString();
    });
  }

  async searchElements(query: string, options: ElementSearchOptions = {}): Promise<ElementSearchResult[]> {
    const normalizedName = normalizeSearchText(options.name ?? '');
    const candidates = this.elements.flatMap((element) => element.facts.map((fact) => ({
      id: fact.id,
      elementId: element.id,
      name: element.name,
      aliases: element.aliases,
      type: element.type,
      fact,
      updatedAt: element.updatedAt,
    })));
    const bm25 = bm25Rank(candidates, query, (hit) => weightedSearchTokens([
      [hit.name, 5],
      [hit.aliases.join(' '), 4],
      [hit.type, 2],
      [hit.fact.key, 4],
      [Array.isArray(hit.fact.value) ? hit.fact.value.join(' ') : hit.fact.value, 5],
    ])).map(({ item }) => item);
    const nameMatches = normalizedName ? candidates.filter((hit) =>
      fuzzySearchMatch(hit.name, normalizedName)
      || hit.aliases.some((alias) => fuzzySearchMatch(alias, normalizedName))) : [];
    const typeMatches = options.type ? candidates.filter((hit) => hit.type === options.type) : [];
    const recent = (items: typeof candidates): typeof candidates => [...items]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
    const hasStructuredFilter = Boolean(normalizedName || options.type);
    const nameIds = new Set(nameMatches.map(({ id }) => id));
    const typeIds = new Set(typeMatches.map(({ id }) => id));
    const exactStructuredMatches = hasStructuredFilter ? candidates.filter((hit) =>
      (!normalizedName || nameIds.has(hit.id)) && (!options.type || typeIds.has(hit.id))) : [];
    const rankings: typeof candidates[] = [];
    if (exactStructuredMatches.length > 0) {
      const exactIds = new Set(exactStructuredMatches.map(({ id }) => id));
      rankings.push(bm25.filter(({ id }) => exactIds.has(id)), recent(exactStructuredMatches));
    } else {
      rankings.push(bm25);
      if (nameMatches.length > 0) rankings.push(recent(nameMatches));
      if (typeMatches.length > 0) rankings.push(recent(typeMatches));
    }
    if (searchTokens(query).length > 0 && bm25.length === 0 && !hasStructuredFilter) return [];
    if (!rankings.some((ranking) => ranking.length > 0)) {
      if (searchTokens(query).length > 0) return [];
      rankings.push(recent(candidates));
    }
    const ranked = rrfRank(rankings).slice(0, Math.max(1, Math.min(12, options.limit ?? 8)));
    if (ranked.length > 0) {
      const now = this.now().toISOString();
      await this.commitMutation(() => {
        for (const elementId of new Set(ranked.map(({ item }) => item.elementId))) {
          const element = this.elements.find(({ id }) => id === elementId);
          if (element) element.weight.lastRetrievedAt = now;
        }
      });
    }
    return ranked.map(({ item, score }) => ({
      id: item.id,
      elementId: item.elementId,
      name: item.name,
      type: item.type,
      fact: item.fact,
      score,
    }));
  }

  expandElement(id: string, at?: string): ElementCard {
    const element = this.elements.find((candidate) => candidate.id === id);
    if (!element) throw new Error(`Unknown element: ${id}`);
    return elementViewAt(element, at);
  }

  searchRawMemory(query: string, limit = 6): RawSearchHit[] {
    const tokens = searchTokens(query);
    if (tokens.length === 0) return [];
    const hits: RawSearchHit[] = [];
    for (const block of this.blocks) {
      for (const [index, message] of block.l5Raw.entries()) {
        const messageTokens = new Set(searchTokens(message.content));
        if (!tokens.some((token) => messageTokens.has(token))) continue;
        hits.push({
          blockId: block.id,
          turnRange: [block.startTurn, block.endTurn],
          message,
          nearby: block.l5Raw.slice(Math.max(0, index - 1), index + 2),
        });
        if (hits.length >= limit) return hits;
      }
    }
    return hits;
  }

  getBlockContext(): BlockContextEntry[] {
    return this.blocks.map((block) => {
      const level = getDecayedBlockLevel(block.pointerAnchorLevel, block.pointerAnchorTurn, this.currentTurn);
      block.pointerCurrentLevel = level;
      return {
        id: block.id,
        turnRange: [block.startTurn, block.endTurn],
        level,
        label: blockLevelLabel(level),
        content: renderBlock(block, level),
      };
    });
  }

  async expandBlock(id: string, target: unknown = 'next'): Promise<BlockContextEntry> {
    return this.commitMutation(() => {
      const block = this.blocks.find((candidate) => candidate.id === id);
      if (!block) throw new Error(`Unknown block: ${id}`);
      const current = getDecayedBlockLevel(block.pointerAnchorLevel, block.pointerAnchorTurn, this.currentTurn);
      const level = normalizeBlockLevel(target, current);
      block.pointerCurrentLevel = level;
      block.pointerAnchorLevel = level;
      block.pointerAnchorTurn = this.currentTurn;
      block.lastLiftedAt = this.now().toISOString();
      return {
        id: block.id,
        turnRange: [block.startTurn, block.endTurn] as [number, number],
        level,
        label: blockLevelLabel(level),
        content: renderBlock(block, level),
      };
    });
  }

  assessRetrieval(input: RetrievalAssessmentInput, latestEvidenceRefs: ReadonlySet<string>): RetrievalAssessment {
    return normalizeRetrievalAssessment(input, latestEvidenceRefs);
  }

  async recordMemoryUse(refs: readonly string[] | MemoryUseRefs, options: RecordMemoryUseOptions = {}): Promise<void> {
    const receiptId = options.receiptId?.trim();
    if (this.storage && !receiptId) throw new TypeError('Persistent recordMemoryUse requires a non-empty receiptId');
    const normalizedRefs: MemoryUseRefs = Array.isArray(refs)
      ? { eventIds: refs as readonly string[] }
      : refs as MemoryUseRefs;
    const requestedEventIds = [...new Set(normalizedRefs.eventIds ?? [])];
    const requestedElementIds = [...new Set(normalizedRefs.elementIds ?? [])];
    if (receiptId) {
      const existing = this.usageReceipts.get(receiptId);
      if (existing) {
        if (!sameIds(existing.eventIds, requestedEventIds)
          || !sameIds(existing.elementIds, requestedElementIds)) {
          throw new Error(`Usage receipt ${receiptId} was already recorded with different memory IDs`);
        }
        return;
      }
    }

    await this.commitMutation(() => {
      const now = this.now().toISOString();
      for (const id of requestedEventIds) {
        const event = this.events.find((candidate) => candidate.id === id);
        if (!event || event.status === 'forgotten' || event.status === 'archived') continue;
        event.weight.mentionCount += 1;
        event.weight.lastAdoptedTurn = this.currentTurn;
        event.updatedAt = now;
      }
      for (const id of requestedElementIds) {
        const element = this.elements.find((candidate) => candidate.id === id);
        if (!element) continue;
        element.weight.mentionCount += 1;
        element.weight.lastAdoptedTurn = this.currentTurn;
        element.updatedAt = now;
      }
      if (receiptId) this.usageReceipts.set(receiptId, {
        id: receiptId,
        eventIds: requestedEventIds,
        elementIds: requestedElementIds,
        createdAt: now,
      });
    });
  }

  async pinEvent(id: string, pinned = true): Promise<void> {
    await this.commitMutation(() => {
      const event = this.requireEvent(id);
      event.weight.pinned = pinned;
      event.updatedAt = this.now().toISOString();
    });
  }

  async forgetEvent(id: string): Promise<void> {
    await this.commitMutation(() => {
      const event = this.requireEvent(id);
      event.status = 'forgotten';
      event.updatedAt = this.now().toISOString();
    });
  }

  async restoreEvent(id: string): Promise<void> {
    await this.commitMutation(() => {
      const event = this.requireEvent(id);
      event.status = 'active';
      event.updatedAt = this.now().toISOString();
    });
  }

  async close(): Promise<void> {
    await this.storage?.close?.();
  }

  private addEventInMemory(input: EventCardInput): EventCard {
    const sourceBlock = this.blocks.find((block) => block.id === input.sourceBlockId);
    if (!sourceBlock) throw new Error(`Unknown source block: ${input.sourceBlockId}`);
    const validIds = new Set(sourceBlock.l5Raw.map((message) => message.id));
    const requestedRefs = [...new Set(input.sourceMessageIds.filter((id) => validIds.has(id)))];
    const sourceMessageIds = requestedRefs.length > 0 ? requestedRefs : sourceBlock.l5Raw.map((message) => message.id);
    const now = this.now().toISOString();
    const criticality = input.criticality ?? 'routine';
    const event: EventCard = {
      id: input.id ?? this.idFactory('evt'),
      title: input.title.trim(),
      summary: input.summary.trim(),
      narrative: input.narrative?.trim() || input.summary.trim(),
      tags: [...new Set(input.tags ?? [])].slice(0, 12),
      quotes: [...new Set(input.quotes ?? [])].slice(0, 12),
      sourceMessageIds,
      sourceBlockId: sourceBlock.id,
      temporal: input.temporal ? { ...input.temporal } : { mentionedAt: now },
      scope: input.scope ?? 'user',
      criticality,
      confidence: Math.max(0, Math.min(1, input.confidence ?? 1)),
      status: 'active',
      supersededBy: null,
      weight: {
        mentionCount: 1,
        lastAdoptedTurn: this.currentTurn,
        lastRetrievedAt: null,
        pinned: false,
        floorWeight: criticalityFloor(criticality),
        forcedCap: null,
      },
      createdAt: now,
      updatedAt: now,
    };
    if (this.events.some((candidate) => candidate.id === event.id)) throw new Error(`Duplicate event ID: ${event.id}`);
    this.events.push(event);

    for (const supersededId of event.temporal.supersedesEventIds ?? []) {
      const old = this.events.find((candidate) => candidate.id === supersededId && candidate.id !== event.id);
      if (!old) continue;
      old.status = 'superseded';
      old.supersededBy = event.id;
      old.weight.forcedCap = 0.1;
      old.updatedAt = now;
    }
    return event;
  }

  private requireEvent(id: string): EventCard {
    const event = this.events.find((candidate) => candidate.id === id);
    if (!event) throw new Error(`Unknown event: ${id}`);
    return event;
  }

  private requireElementProjectionJob(id: string): ElementProjectionJob {
    const job = this.elementProjectionJobs.get(id);
    if (!job) throw new Error(`Unknown element projection: ${id}`);
    return job;
  }

  private queueElementProjection(sourceEventIds: readonly string[]): ElementProjectionJob | null {
    const ids = [...new Set(sourceEventIds.filter((id) => this.events.some((event) => event.id === id)))];
    if (ids.length === 0) return null;
    const now = this.now().toISOString();
    const job: ElementProjectionJob = {
      id: this.elementIdFactory('proj'),
      sourceEventIds: ids,
      status: 'pending',
      attempts: 0,
      elementIds: [],
      reason: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.elementProjectionJobs.set(job.id, job);
    return job;
  }

  private pendingBlockMessages(): RawMessage[] {
    let users = 0;
    let end = this.openTail.length;
    for (const [index, message] of this.openTail.entries()) {
      if (message.role !== 'user') continue;
      users += 1;
      if (users !== this.blockTurnSize) continue;
      const nextUserOffset = this.openTail.slice(index + 1).findIndex((candidate) => candidate.role === 'user');
      end = nextUserOffset === -1 ? this.openTail.length : index + 1 + nextUserOffset;
      break;
    }
    return this.openTail.slice(0, end);
  }

  private async sealOpenTail(): Promise<MemoryBlock> {
    const raw = this.pendingBlockMessages();
    if (raw.filter((message) => message.role === 'user').length < this.blockTurnSize) {
      throw new Error('Open tail does not contain enough turns to seal a block');
    }
    const generated = this.summarizer ? await this.summarizer(raw) : defaultSummary(raw);
    const deterministic = deterministicBlockLayers(raw);
    const sequence = this.blocks.length + 1;
    const startTurn = this.blocks.at(-1)?.endTurn !== undefined ? (this.blocks.at(-1)?.endTurn ?? 0) + 1 : 1;
    const endTurn = startTurn + this.blockTurnSize - 1;
    return this.commitMutation(() => {
      const currentRaw = this.pendingBlockMessages();
      if (!sameIds(currentRaw.map((message) => message.id), raw.map((message) => message.id))) {
        throw new Error('Open tail changed while the block summary was being prepared');
      }
      const block: MemoryBlock = {
        id: this.idFactory('blk'),
        sequence,
        startTurn,
        endTurn,
        createdAt: raw.at(-1)?.createdAt ?? this.now().toISOString(),
        l0Title: generated.l0Title,
        l0Tags: generated.l0Tags,
        l1Summary: generated.l1Summary,
        l2Keypoints: generated.l2Keypoints,
        shouldExtract: generated.shouldExtract,
        ...deterministic,
        pointerCurrentLevel: 5,
        pointerAnchorLevel: 5,
        pointerAnchorTurn: endTurn,
        lastLiftedAt: null,
      };
      this.openTail.splice(0, raw.length);
      this.blocks.push(block);
      return block;
    });
  }

  private async extractEligibleBlock(): Promise<EventCard[] | null> {
    if (!this.extractor || this.blocks.length < 2) return null;
    const targetIndex = this.blocks.findIndex((block, index) => {
      if (index >= this.blocks.length - 1 || !block.shouldExtract) return false;
      const status = this.extractionJobs.get(block.id)?.status;
      return status === undefined || status === 'failed';
    });
    if (targetIndex < 0) return null;
    const target = this.blocks[targetIndex];
    const next = this.blocks[targetIndex + 1];
    if (!target || !next) return null;
    const existing = this.extractionJobs.get(target.id);
    await this.commitMutation(() => {
      const currentStatus = this.extractionJobs.get(target.id)?.status;
      if (currentStatus !== undefined && currentStatus !== 'failed') {
        throw new Error(`Extraction block ${target.id} is already ${currentStatus}`);
      }
      this.extractionJobs.set(target.id, {
        blockId: target.id,
        status: 'running',
        attempts: (existing?.attempts ?? 0) + 1,
        lastError: null,
        updatedAt: this.now().toISOString(),
      });
    });

    let result: Awaited<ReturnType<EventExtractor>>;
    try {
      result = await this.extractor({
        previous: this.blocks[targetIndex - 1] ?? null,
        target,
        next,
        timeline: this.events.map((event) => ({ id: event.id, title: event.title, temporal: event.temporal })),
      });
    } catch (error) {
      await this.commitMutation(() => {
        const job = this.extractionJobs.get(target.id);
        if (!job) return;
        this.extractionJobs.set(target.id, {
          ...job,
          status: 'failed',
          lastError: errorMessage(error),
          updatedAt: this.now().toISOString(),
        });
      });
      throw error;
    }

    return this.commitMutation(() => {
      const extracted = result.shouldExtract
        ? result.events.map((event) => this.addEventInMemory({ ...event, sourceBlockId: target.id }))
        : [];
      if (extracted.length > 0) this.queueElementProjection(extracted.map(({ id }) => id));
      const job = this.extractionJobs.get(target.id);
      if (!job) throw new Error(`Missing extraction job for block: ${target.id}`);
      this.extractionJobs.set(target.id, {
        ...job,
        status: result.shouldExtract ? 'succeeded' : 'skipped',
        lastError: null,
        updatedAt: this.now().toISOString(),
      });
      return extracted;
    });
  }

  private async projectEligibleElements(): Promise<ElementCard[] | null> {
    if (!this.elementProjector) return null;
    const batch = await this.claimNextElementProjection();
    if (!batch) return null;
    try {
      const result = await this.elementProjector(batch);
      return await this.completeElementProjection(batch.jobId, result);
    } catch (error) {
      await this.failElementProjection(batch.jobId, error);
      throw error;
    }
  }

  private async commitMutation<T>(mutation: () => T | Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release!: () => void;
    this.mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    if (!this.storage) {
      try {
        return await mutation();
      } finally {
        release();
      }
    }

    const before = this.exportSnapshot();
    const beforeRevision = this.revision;
    try {
      const result = await mutation();
      await this.persist();
      return result;
    } catch (error) {
      this.restoreSnapshot(before);
      this.revision = beforeRevision;
      throw error;
    } finally {
      release();
    }
  }

  private async persist(): Promise<void> {
    if (!this.storage || !this.namespace) return;
    this.revision = await this.storage.save(this.namespace, this.exportSnapshot(), this.revision);
  }

  private restoreSnapshot(snapshot: StrataGateSnapshot): void {
    const normalized = normalizeSnapshot(snapshot);
    if (normalized.blockTurnSize !== this.blockTurnSize) {
      throw new Error(`Snapshot blockTurnSize ${normalized.blockTurnSize} does not match ${this.blockTurnSize}`);
    }
    const copy = cloneSnapshot(normalized);
    this.currentTurn = copy.currentTurn;
    this.openTail.splice(0, this.openTail.length, ...copy.openTail);
    this.blocks.splice(0, this.blocks.length, ...copy.blocks);
    this.events.splice(0, this.events.length, ...copy.events);
    this.elements.splice(0, this.elements.length, ...copy.elements);
    this.extractionJobs.clear();
    for (const job of copy.extractionJobs) this.extractionJobs.set(job.blockId, job);
    this.elementProjectionJobs.clear();
    for (const job of copy.elementProjectionJobs) this.elementProjectionJobs.set(job.id, job);
    this.usageReceipts.clear();
    for (const receipt of copy.usageReceipts) this.usageReceipts.set(receipt.id, receipt);
    this.ingestionReceipts.clear();
    for (const receipt of copy.ingestionReceipts) this.ingestionReceipts.set(receipt.id, receipt);
    this.validateReferences();
  }

  private validateReferences(): void {
    const blockIds = new Set<string>();
    const messageBlockIds = new Map<string, string>();
    for (const block of this.blocks) {
      if (blockIds.has(block.id)) throw new Error(`Duplicate block ID in snapshot: ${block.id}`);
      blockIds.add(block.id);
      for (const message of block.l5Raw) {
        if (messageBlockIds.has(message.id)) throw new Error(`Duplicate message ID in snapshot: ${message.id}`);
        messageBlockIds.set(message.id, block.id);
      }
    }
    for (const message of this.openTail) {
      if (messageBlockIds.has(message.id)) throw new Error(`Duplicate message ID in snapshot: ${message.id}`);
      messageBlockIds.set(message.id, 'open-tail');
    }
    const eventIds = new Set<string>();
    for (const event of this.events) {
      if (eventIds.has(event.id)) throw new Error(`Duplicate event ID in snapshot: ${event.id}`);
      eventIds.add(event.id);
      if (!blockIds.has(event.sourceBlockId)) throw new Error(`Unknown event source block in snapshot: ${event.sourceBlockId}`);
      for (const messageId of event.sourceMessageIds) {
        if (messageBlockIds.get(messageId) !== event.sourceBlockId) {
          throw new Error(`Event ${event.id} references a message outside source block ${event.sourceBlockId}`);
        }
      }
    }
    for (const job of this.extractionJobs.values()) {
      if (!blockIds.has(job.blockId)) throw new Error(`Unknown extraction job block in snapshot: ${job.blockId}`);
    }
    const elementIds = new Set<string>();
    for (const element of this.elements) {
      if (elementIds.has(element.id)) throw new Error(`Duplicate element ID in snapshot: ${element.id}`);
      elementIds.add(element.id);
      for (const eventId of element.sourceEventIds) {
        if (!eventIds.has(eventId)) throw new Error(`Element ${element.id} references unknown event ${eventId}`);
      }
      const sourceMessageIds = new Set(element.sourceEventIds.flatMap((eventId) =>
        this.events.find((event) => event.id === eventId)?.sourceMessageIds ?? []));
      for (const messageId of element.sourceMessageIds) {
        if (!sourceMessageIds.has(messageId)) {
          throw new Error(`Element ${element.id} references message ${messageId} outside its source events`);
        }
      }
      for (const fact of element.facts) {
        for (const eventId of fact.sourceEventIds) {
          if (!eventIds.has(eventId)) throw new Error(`Element fact ${fact.id} references unknown event ${eventId}`);
        }
      }
    }
    for (const job of this.elementProjectionJobs.values()) {
      for (const eventId of job.sourceEventIds) {
        if (!eventIds.has(eventId)) throw new Error(`Element projection ${job.id} references unknown event ${eventId}`);
      }
      for (const elementId of job.elementIds) {
        if (!elementIds.has(elementId)) throw new Error(`Element projection ${job.id} references unknown element ${elementId}`);
      }
    }
  }
}
