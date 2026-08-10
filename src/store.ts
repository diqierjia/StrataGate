import {
  DEFAULT_BLOCK_TURN_SIZE,
  blockLevelLabel,
  deterministicBlockLayers,
  getDecayedBlockLevel,
  normalizeBlockLevel,
} from './blocks.js';
import { normalizeRetrievalAssessment, type RetrievalAssessment, type RetrievalAssessmentInput } from './retrieval.js';
import type {
  AppendTurnResult,
  BlockLevel,
  BlockSummarizer,
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
  now?: () => Date;
  idFactory?: (prefix: 'msg' | 'blk' | 'evt') => string;
}

export interface TurnInput {
  user: string;
  assistant: string;
  createdAt?: string;
  userToolCalls?: ToolTrace[];
  assistantToolCalls?: ToolTrace[];
}

export interface BlockContextEntry {
  id: string;
  turnRange: [number, number];
  level: BlockLevel;
  label: string;
  content: string;
}

function defaultIdFactory(prefix: 'msg' | 'blk' | 'evt'): string {
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

function normalizeText(value: string): string {
  return value.toLocaleLowerCase().normalize('NFKC');
}

function queryTokens(value: string): string[] {
  const normalized = normalizeText(value);
  const words = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const cjkRuns = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? [];
  const bigrams = cjkRuns.flatMap((run) => Array.from({ length: Math.max(0, run.length - 1) }, (_, index) => run.slice(index, index + 2)));
  return [...new Set([...words, ...bigrams].filter((token) => token.length > 1))];
}

function renderBlock(block: MemoryBlock, level: BlockLevel): string {
  if (level === 0) return `${block.l0Title}\nTags: ${block.l0Tags.join(', ') || 'none'}`;
  if (level === 1) return block.l1Summary || block.l0Title;
  if (level === 2) return block.l2Keypoints.map((point) => `- ${point}`).join('\n') || block.l1Summary;
  if (level === 3) return block.l3Condensed;
  if (level === 4) return block.l4Readable;
  return block.l5Raw.map((message) => `${message.role}: ${message.content}`).join('\n\n');
}

export class StrataGate {
  readonly blockTurnSize: number;

  private readonly summarizer: BlockSummarizer | undefined;
  private readonly extractor: EventExtractor | undefined;
  private readonly now: () => Date;
  private readonly idFactory: (prefix: 'msg' | 'blk' | 'evt') => string;
  private readonly openTail: RawMessage[] = [];
  private readonly blocks: MemoryBlock[] = [];
  private readonly events: EventCard[] = [];
  private readonly extractedBlockIds = new Set<string>();
  private currentTurn = 0;

  constructor(options: StrataGateOptions = {}) {
    this.blockTurnSize = Math.max(1, Math.floor(options.blockTurnSize ?? DEFAULT_BLOCK_TURN_SIZE));
    this.summarizer = options.summarizer;
    this.extractor = options.extractor;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? defaultIdFactory;
  }

  get turn(): number {
    return this.currentTurn;
  }

  listBlocks(): readonly MemoryBlock[] {
    return this.blocks;
  }

  listEvents(): readonly EventCard[] {
    return this.events;
  }

  listOpenTail(): readonly RawMessage[] {
    return this.openTail;
  }

  async appendTurn(input: TurnInput): Promise<AppendTurnResult> {
    this.currentTurn += 1;
    const createdAt = input.createdAt ?? this.now().toISOString();
    this.openTail.push(
      {
        id: this.idFactory('msg'),
        role: 'user',
        content: input.user,
        createdAt,
        ...(input.userToolCalls ? { toolCalls: input.userToolCalls } : {}),
      },
      {
        id: this.idFactory('msg'),
        role: 'assistant',
        content: input.assistant,
        createdAt,
        ...(input.assistantToolCalls ? { toolCalls: input.assistantToolCalls } : {}),
      },
    );

    if (this.openTail.filter((message) => message.role === 'user').length < this.blockTurnSize) {
      return { sealedBlock: null, extractedEvents: [] };
    }

    const sealedBlock = await this.sealOpenTail();
    const extractedEvents = await this.extractEligibleBlock();
    return { sealedBlock, extractedEvents };
  }

  addEvent(input: EventCardInput): EventCard {
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

  searchEvents(query: string, options: SearchOptions = {}): EventSearchResult[] {
    const tokens = queryTokens(query);
    const participants = (options.participants ?? []).map(normalizeText);
    const eventType = options.eventType ? normalizeText(options.eventType) : null;
    const now = this.now().toISOString();
    const ranked = this.events
      .filter((event) => event.status === 'active' || event.status === 'superseded')
      .filter((event) => participants.length === 0 || participants.every((person) =>
        (event.temporal.participants ?? []).some((candidate) => normalizeText(candidate).includes(person))))
      .filter((event) => !eventType || normalizeText(event.temporal.eventType ?? '').includes(eventType))
      .map((event) => {
        const temporal = event.temporal;
        const searchable = normalizeText([
          event.title,
          event.summary,
          event.narrative,
          ...event.tags,
          ...event.quotes,
          ...(temporal.participants ?? []),
          temporal.eventType ?? '',
          temporal.happenedStart ?? '',
          temporal.happenedEnd ?? '',
          temporal.originalText ?? '',
        ].join(' '));
        const matched = tokens.filter((token) => searchable.includes(token)).length;
        const lexical = tokens.length === 0 ? 0 : matched / tokens.length;
        const timeBonus = options.temporalIntent && /(\d{4}|when|before|after|first|last|何时|什么时候|之前|之后|最早|最近)/iu.test(query)
          && Boolean(temporal.happenedStart || temporal.happenedEnd) ? 0.2 : 0;
        const statusPenalty = event.status === 'superseded' ? -0.25 : 0;
        return { event, score: lexical * 2 + memoryWeightAt(event, this.currentTurn) + timeBonus + statusPenalty };
      })
      .filter(({ score }) => tokens.length === 0 || score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(20, options.limit ?? 6)));

    for (const { event } of ranked) event.weight.lastRetrievedAt = now;
    if (options.temporalIntent) {
      ranked.sort((a, b) => (a.event.temporal.happenedStart ?? '').localeCompare(b.event.temporal.happenedStart ?? ''));
    }
    return ranked;
  }

  searchRawMemory(query: string, limit = 6): RawSearchHit[] {
    const tokens = queryTokens(query);
    if (tokens.length === 0) return [];
    const hits: RawSearchHit[] = [];
    for (const block of this.blocks) {
      for (const [index, message] of block.l5Raw.entries()) {
        const text = normalizeText(message.content);
        if (!tokens.some((token) => text.includes(token))) continue;
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

  expandBlock(id: string, target: unknown = 'next'): BlockContextEntry {
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
      turnRange: [block.startTurn, block.endTurn],
      level,
      label: blockLevelLabel(level),
      content: renderBlock(block, level),
    };
  }

  assessRetrieval(input: RetrievalAssessmentInput, latestEvidenceRefs: ReadonlySet<string>): RetrievalAssessment {
    return normalizeRetrievalAssessment(input, latestEvidenceRefs);
  }

  recordMemoryUse(eventIds: readonly string[]): void {
    const now = this.now().toISOString();
    for (const id of new Set(eventIds)) {
      const event = this.events.find((candidate) => candidate.id === id);
      if (!event || event.status === 'forgotten' || event.status === 'archived') continue;
      event.weight.mentionCount += 1;
      event.weight.lastAdoptedTurn = this.currentTurn;
      event.updatedAt = now;
    }
  }

  pinEvent(id: string, pinned = true): void {
    const event = this.requireEvent(id);
    event.weight.pinned = pinned;
    event.updatedAt = this.now().toISOString();
  }

  forgetEvent(id: string): void {
    const event = this.requireEvent(id);
    event.status = 'forgotten';
    event.updatedAt = this.now().toISOString();
  }

  restoreEvent(id: string): void {
    const event = this.requireEvent(id);
    event.status = 'active';
    event.updatedAt = this.now().toISOString();
  }

  private requireEvent(id: string): EventCard {
    const event = this.events.find((candidate) => candidate.id === id);
    if (!event) throw new Error(`Unknown event: ${id}`);
    return event;
  }

  private async sealOpenTail(): Promise<MemoryBlock> {
    const raw = this.openTail.splice(0, this.openTail.length);
    const generated = this.summarizer ? await this.summarizer(raw) : defaultSummary(raw);
    const deterministic = deterministicBlockLayers(raw);
    const sequence = this.blocks.length + 1;
    const endTurn = this.currentTurn;
    const block: MemoryBlock = {
      id: this.idFactory('blk'),
      sequence,
      startTurn: endTurn - this.blockTurnSize + 1,
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
    this.blocks.push(block);
    return block;
  }

  private async extractEligibleBlock(): Promise<EventCard[]> {
    if (!this.extractor || this.blocks.length < 2) return [];
    const targetIndex = this.blocks.length - 2;
    const target = this.blocks[targetIndex];
    const next = this.blocks[targetIndex + 1];
    if (!target || !next || !target.shouldExtract || this.extractedBlockIds.has(target.id)) return [];
    this.extractedBlockIds.add(target.id);
    const previous = this.blocks[targetIndex - 1] ?? null;
    const result = await this.extractor({
      previous,
      target,
      next,
      timeline: this.events.map((event) => ({ id: event.id, title: event.title, temporal: event.temporal })),
    });
    if (!result.shouldExtract) return [];
    return result.events.map((event) => this.addEvent({ ...event, sourceBlockId: target.id }));
  }
}
