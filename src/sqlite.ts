import Database from 'better-sqlite3';
import {
  STRATAGATE_STORAGE_SCHEMA_VERSION,
  StorageConflictError,
  assertValidSnapshot,
  cloneSnapshot,
  type ElementProjectionJob,
  type ExtractionJob,
  type LoadedStrataGateState,
  type StorageAdapter,
  type StrataGateSnapshot,
  type UsageReceipt,
} from './storage.js';
import type {
  BlockLevel,
  ElementCard,
  ElementFact,
  ElementFactMode,
  ElementFactStatus,
  EventCard,
  EventTemporal,
  MemoryBlock,
  MemoryCriticality,
  MemoryScope,
  MemoryStatus,
  MemoryElementType,
  RawMessage,
  ToolTrace,
} from './types.js';

export interface SqliteStorageOptions {
  filename: string;
  readonly?: boolean;
  timeoutMs?: number;
}

interface SpaceRow {
  schema_version: number;
  revision: number;
  current_turn: number;
  block_turn_size: number;
}

interface MessageRow {
  id: string;
  block_id: string | null;
  position: number;
  role: RawMessage['role'];
  content: string;
  created_at: string;
  tool_calls_json: string | null;
}

interface BlockRow {
  id: string;
  sequence: number;
  start_turn: number;
  end_turn: number;
  created_at: string;
  should_extract: number;
  l0_title: string;
  l0_tags_json: string;
  l1_summary: string;
  l2_keypoints_json: string;
  l3_condensed: string;
  l4_readable: string;
  pointer_current_level: number;
  pointer_anchor_level: number;
  pointer_anchor_turn: number;
  last_lifted_at: string | null;
}

interface EventRow {
  id: string;
  position: number;
  title: string;
  summary: string;
  narrative: string;
  tags_json: string;
  quotes_json: string;
  source_block_id: string;
  temporal_json: string;
  scope: MemoryScope;
  criticality: MemoryCriticality;
  confidence: number;
  status: MemoryStatus;
  superseded_by: string | null;
  mention_count: number;
  last_adopted_turn: number;
  last_retrieved_at: string | null;
  pinned: number;
  floor_weight: number;
  forced_cap: number | null;
  created_at: string;
  updated_at: string;
}

interface EventSourceRow {
  event_id: string;
  message_id: string;
  position: number;
}

interface ExtractionJobRow {
  block_id: string;
  status: ExtractionJob['status'];
  attempts: number;
  last_error: string | null;
  updated_at: string;
}

interface UsageReceiptRow {
  receipt_id: string;
  event_ids_json: string;
  element_ids_json: string;
  created_at: string;
}

interface ElementRow {
  id: string;
  position: number;
  name: string;
  type: MemoryElementType;
  aliases_json: string;
  current_state: string;
  mention_count: number;
  last_adopted_turn: number;
  last_retrieved_at: string | null;
  pinned: number;
  floor_weight: number;
  forced_cap: number | null;
  created_at: string;
  updated_at: string;
}

interface ElementFactRow {
  id: string;
  element_id: string;
  position: number;
  key: string;
  mode: ElementFactMode;
  value_json: string;
  valid_from: string | null;
  valid_to: string | null;
  confidence: number | null;
  status: ElementFactStatus;
  created_at: string;
  updated_at: string;
}

interface ElementSourceRow {
  element_id: string;
  event_id: string;
  position: number;
}

interface ElementFactSourceRow {
  fact_id: string;
  event_id: string;
  position: number;
}

interface ElementProjectionJobRow {
  id: string;
  source_event_ids_json: string;
  status: ElementProjectionJob['status'];
  attempts: number;
  element_ids_json: string;
  reason: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_spaces (
  namespace TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  current_turn INTEGER NOT NULL,
  block_turn_size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS blocks (
  namespace TEXT NOT NULL,
  id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  start_turn INTEGER NOT NULL,
  end_turn INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  should_extract INTEGER NOT NULL,
  l0_title TEXT NOT NULL,
  l0_tags_json TEXT NOT NULL,
  l1_summary TEXT NOT NULL,
  l2_keypoints_json TEXT NOT NULL,
  l3_condensed TEXT NOT NULL,
  l4_readable TEXT NOT NULL,
  pointer_current_level INTEGER NOT NULL,
  pointer_anchor_level INTEGER NOT NULL,
  pointer_anchor_turn INTEGER NOT NULL,
  last_lifted_at TEXT,
  PRIMARY KEY (namespace, id),
  UNIQUE (namespace, sequence),
  FOREIGN KEY (namespace) REFERENCES memory_spaces(namespace) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS messages (
  namespace TEXT NOT NULL,
  id TEXT NOT NULL,
  block_id TEXT,
  position INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  tool_calls_json TEXT,
  PRIMARY KEY (namespace, id),
  FOREIGN KEY (namespace) REFERENCES memory_spaces(namespace) ON DELETE CASCADE,
  FOREIGN KEY (namespace, block_id) REFERENCES blocks(namespace, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS messages_container_idx ON messages(namespace, block_id, position);

CREATE TABLE IF NOT EXISTS events (
  namespace TEXT NOT NULL,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  narrative TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  quotes_json TEXT NOT NULL,
  source_block_id TEXT NOT NULL,
  temporal_json TEXT NOT NULL,
  scope TEXT NOT NULL,
  criticality TEXT NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL,
  superseded_by TEXT,
  mention_count INTEGER NOT NULL,
  last_adopted_turn INTEGER NOT NULL,
  last_retrieved_at TEXT,
  pinned INTEGER NOT NULL,
  floor_weight REAL NOT NULL,
  forced_cap REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, id),
  FOREIGN KEY (namespace, source_block_id) REFERENCES blocks(namespace, id)
) STRICT;

CREATE TABLE IF NOT EXISTS event_sources (
  namespace TEXT NOT NULL,
  event_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (namespace, event_id, message_id),
  FOREIGN KEY (namespace, event_id) REFERENCES events(namespace, id) ON DELETE CASCADE,
  FOREIGN KEY (namespace, message_id) REFERENCES messages(namespace, id)
) STRICT;

CREATE TABLE IF NOT EXISTS elements (
  namespace TEXT NOT NULL,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  current_state TEXT NOT NULL,
  mention_count INTEGER NOT NULL,
  last_adopted_turn INTEGER NOT NULL,
  last_retrieved_at TEXT,
  pinned INTEGER NOT NULL,
  floor_weight REAL NOT NULL,
  forced_cap REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, id),
  FOREIGN KEY (namespace) REFERENCES memory_spaces(namespace) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS element_sources (
  namespace TEXT NOT NULL,
  element_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (namespace, element_id, event_id),
  FOREIGN KEY (namespace, element_id) REFERENCES elements(namespace, id) ON DELETE CASCADE,
  FOREIGN KEY (namespace, event_id) REFERENCES events(namespace, id)
) STRICT;

CREATE TABLE IF NOT EXISTS element_facts (
  namespace TEXT NOT NULL,
  id TEXT NOT NULL,
  element_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  key TEXT NOT NULL,
  mode TEXT NOT NULL,
  value_json TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  confidence REAL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, id),
  FOREIGN KEY (namespace, element_id) REFERENCES elements(namespace, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS element_fact_sources (
  namespace TEXT NOT NULL,
  fact_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (namespace, fact_id, event_id),
  FOREIGN KEY (namespace, fact_id) REFERENCES element_facts(namespace, id) ON DELETE CASCADE,
  FOREIGN KEY (namespace, event_id) REFERENCES events(namespace, id)
) STRICT;

CREATE TABLE IF NOT EXISTS extraction_jobs (
  namespace TEXT NOT NULL,
  block_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, block_id),
  FOREIGN KEY (namespace, block_id) REFERENCES blocks(namespace, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS element_projection_jobs (
  namespace TEXT NOT NULL,
  id TEXT NOT NULL,
  source_event_ids_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  element_ids_json TEXT NOT NULL,
  reason TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, id),
  FOREIGN KEY (namespace) REFERENCES memory_spaces(namespace) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS usage_receipts (
  namespace TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  event_ids_json TEXT NOT NULL,
  element_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (namespace, receipt_id),
  FOREIGN KEY (namespace) REFERENCES memory_spaces(namespace) ON DELETE CASCADE
) STRICT;
`;

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`Invalid JSON in SQLite column ${label}`, { cause: error });
  }
}

function nonEmptyNamespace(namespace: string): string {
  const normalized = namespace.trim();
  if (!normalized) throw new TypeError('Storage namespace must not be empty');
  return normalized;
}

export class SqliteStorage implements StorageAdapter {
  private readonly database: Database.Database;
  private closed = false;

  constructor(options: SqliteStorageOptions) {
    if (!options.filename.trim()) throw new TypeError('SQLite filename must not be empty');
    this.database = new Database(options.filename, {
      readonly: options.readonly ?? false,
      timeout: Math.max(0, Math.floor(options.timeoutMs ?? 5_000)),
    });
    try {
      this.database.pragma('foreign_keys = ON');
      if (!(options.readonly ?? false)) {
        this.database.pragma('journal_mode = WAL');
        this.migrate();
      } else {
        this.assertSchemaVersion();
      }
    } catch (error) {
      this.database.close();
      this.closed = true;
      throw error;
    }
  }

  async load(namespace: string): Promise<LoadedStrataGateState | null> {
    this.assertOpen();
    const key = nonEmptyNamespace(namespace);
    const space = this.database.prepare(`
      SELECT schema_version, revision, current_turn, block_turn_size
      FROM memory_spaces WHERE namespace = ?
    `).get(key) as SpaceRow | undefined;
    if (!space) return null;
    if (space.schema_version !== STRATAGATE_STORAGE_SCHEMA_VERSION) {
      throw new Error(`Unsupported stored StrataGate schema: ${space.schema_version}`);
    }

    const messageRows = this.database.prepare(`
      SELECT id, block_id, position, role, content, created_at, tool_calls_json
      FROM messages WHERE namespace = ? ORDER BY block_id, position
    `).all(key) as MessageRow[];
    const openTail: RawMessage[] = [];
    const messagesByBlock = new Map<string, RawMessage[]>();
    for (const row of messageRows) {
      const message: RawMessage = {
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.created_at,
        ...(row.tool_calls_json ? { toolCalls: parseJson<ToolTrace[]>(row.tool_calls_json, 'messages.tool_calls_json') } : {}),
      };
      if (row.block_id === null) openTail.push(message);
      else {
        const messages = messagesByBlock.get(row.block_id) ?? [];
        messages.push(message);
        messagesByBlock.set(row.block_id, messages);
      }
    }

    const blockRows = this.database.prepare(`
      SELECT * FROM blocks WHERE namespace = ? ORDER BY sequence
    `).all(key) as BlockRow[];
    const blocks: MemoryBlock[] = blockRows.map((row) => ({
      id: row.id,
      sequence: row.sequence,
      startTurn: row.start_turn,
      endTurn: row.end_turn,
      createdAt: row.created_at,
      shouldExtract: Boolean(row.should_extract),
      l0Title: row.l0_title,
      l0Tags: parseJson<string[]>(row.l0_tags_json, 'blocks.l0_tags_json'),
      l1Summary: row.l1_summary,
      l2Keypoints: parseJson<string[]>(row.l2_keypoints_json, 'blocks.l2_keypoints_json'),
      l3Condensed: row.l3_condensed,
      l4Readable: row.l4_readable,
      l5Raw: messagesByBlock.get(row.id) ?? [],
      pointerCurrentLevel: row.pointer_current_level as BlockLevel,
      pointerAnchorLevel: row.pointer_anchor_level as BlockLevel,
      pointerAnchorTurn: row.pointer_anchor_turn,
      lastLiftedAt: row.last_lifted_at,
    }));

    const sourceRows = this.database.prepare(`
      SELECT event_id, message_id, position FROM event_sources
      WHERE namespace = ? ORDER BY event_id, position
    `).all(key) as EventSourceRow[];
    const sourcesByEvent = new Map<string, string[]>();
    for (const row of sourceRows) {
      const ids = sourcesByEvent.get(row.event_id) ?? [];
      ids.push(row.message_id);
      sourcesByEvent.set(row.event_id, ids);
    }

    const eventRows = this.database.prepare(`
      SELECT * FROM events WHERE namespace = ? ORDER BY position
    `).all(key) as EventRow[];
    const events: EventCard[] = eventRows.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      narrative: row.narrative,
      tags: parseJson<string[]>(row.tags_json, 'events.tags_json'),
      quotes: parseJson<string[]>(row.quotes_json, 'events.quotes_json'),
      sourceMessageIds: sourcesByEvent.get(row.id) ?? [],
      sourceBlockId: row.source_block_id,
      temporal: parseJson<EventTemporal>(row.temporal_json, 'events.temporal_json'),
      scope: row.scope,
      criticality: row.criticality,
      confidence: row.confidence,
      status: row.status,
      supersededBy: row.superseded_by,
      weight: {
        mentionCount: row.mention_count,
        lastAdoptedTurn: row.last_adopted_turn,
        lastRetrievedAt: row.last_retrieved_at,
        pinned: Boolean(row.pinned),
        floorWeight: row.floor_weight,
        forcedCap: row.forced_cap,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const elementSourceRows = this.database.prepare(`
      SELECT element_id, event_id, position FROM element_sources
      WHERE namespace = ? ORDER BY element_id, position
    `).all(key) as ElementSourceRow[];
    const sourcesByElement = new Map<string, string[]>();
    for (const row of elementSourceRows) {
      const ids = sourcesByElement.get(row.element_id) ?? [];
      ids.push(row.event_id);
      sourcesByElement.set(row.element_id, ids);
    }

    const elementFactSourceRows = this.database.prepare(`
      SELECT fact_id, event_id, position FROM element_fact_sources
      WHERE namespace = ? ORDER BY fact_id, position
    `).all(key) as ElementFactSourceRow[];
    const sourcesByFact = new Map<string, string[]>();
    for (const row of elementFactSourceRows) {
      const ids = sourcesByFact.get(row.fact_id) ?? [];
      ids.push(row.event_id);
      sourcesByFact.set(row.fact_id, ids);
    }

    const elementFactRows = this.database.prepare(`
      SELECT * FROM element_facts WHERE namespace = ? ORDER BY element_id, position
    `).all(key) as ElementFactRow[];
    const factsByElement = new Map<string, ElementFact[]>();
    for (const row of elementFactRows) {
      const facts = factsByElement.get(row.element_id) ?? [];
      facts.push({
        id: row.id,
        key: row.key,
        mode: row.mode,
        value: parseJson<string | string[]>(row.value_json, 'element_facts.value_json'),
        ...(row.valid_from ? { validFrom: row.valid_from } : {}),
        ...(row.valid_to ? { validTo: row.valid_to } : {}),
        sourceEventIds: sourcesByFact.get(row.id) ?? [],
        ...(row.confidence === null ? {} : { confidence: row.confidence }),
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
      factsByElement.set(row.element_id, facts);
    }

    const elementRows = this.database.prepare(`
      SELECT * FROM elements WHERE namespace = ? ORDER BY position
    `).all(key) as ElementRow[];
    const messagesByEvent = new Map(events.map((event) => [event.id, event.sourceMessageIds]));
    const elements: ElementCard[] = elementRows.map((row) => {
      const sourceEventIds = sourcesByElement.get(row.id) ?? [];
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        aliases: parseJson<string[]>(row.aliases_json, 'elements.aliases_json'),
        currentState: row.current_state,
        facts: factsByElement.get(row.id) ?? [],
        sourceEventIds,
        sourceMessageIds: [...new Set(sourceEventIds.flatMap((id) => messagesByEvent.get(id) ?? []))],
        weight: {
          mentionCount: row.mention_count,
          lastAdoptedTurn: row.last_adopted_turn,
          lastRetrievedAt: row.last_retrieved_at,
          pinned: Boolean(row.pinned),
          floorWeight: row.floor_weight,
          forcedCap: row.forced_cap,
        },
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    const extractionJobs = (this.database.prepare(`
      SELECT block_id, status, attempts, last_error, updated_at
      FROM extraction_jobs WHERE namespace = ? ORDER BY block_id
    `).all(key) as ExtractionJobRow[]).map<ExtractionJob>((row) => ({
      blockId: row.block_id,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error,
      updatedAt: row.updated_at,
    }));

    const elementProjectionJobs = (this.database.prepare(`
      SELECT id, source_event_ids_json, status, attempts, element_ids_json, reason, last_error, created_at, updated_at
      FROM element_projection_jobs WHERE namespace = ? ORDER BY created_at, id
    `).all(key) as ElementProjectionJobRow[]).map<ElementProjectionJob>((row) => ({
      id: row.id,
      sourceEventIds: parseJson<string[]>(row.source_event_ids_json, 'element_projection_jobs.source_event_ids_json'),
      status: row.status,
      attempts: row.attempts,
      elementIds: parseJson<string[]>(row.element_ids_json, 'element_projection_jobs.element_ids_json'),
      reason: row.reason,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const usageReceipts = (this.database.prepare(`
      SELECT receipt_id, event_ids_json, element_ids_json, created_at
      FROM usage_receipts WHERE namespace = ? ORDER BY created_at, receipt_id
    `).all(key) as UsageReceiptRow[]).map<UsageReceipt>((row) => ({
      id: row.receipt_id,
      eventIds: parseJson<string[]>(row.event_ids_json, 'usage_receipts.event_ids_json'),
      elementIds: parseJson<string[]>(row.element_ids_json, 'usage_receipts.element_ids_json'),
      createdAt: row.created_at,
    }));

    const snapshot: StrataGateSnapshot = {
      schemaVersion: STRATAGATE_STORAGE_SCHEMA_VERSION,
      currentTurn: space.current_turn,
      blockTurnSize: space.block_turn_size,
      openTail,
      blocks,
      events,
      elements,
      extractionJobs,
      elementProjectionJobs,
      usageReceipts,
    };
    assertValidSnapshot(snapshot);
    return { snapshot: cloneSnapshot(snapshot), revision: space.revision };
  }

  async save(namespace: string, snapshot: StrataGateSnapshot, expectedRevision: number): Promise<number> {
    this.assertOpen();
    assertValidSnapshot(snapshot);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new TypeError('expectedRevision must be a non-negative integer');
    }
    const key = nonEmptyNamespace(namespace);
    const persist = this.database.transaction(() => this.persistSnapshot(key, snapshot, expectedRevision));
    return persist.immediate();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private persistSnapshot(namespace: string, snapshot: StrataGateSnapshot, expectedRevision: number): number {
    const current = this.database.prepare('SELECT revision FROM memory_spaces WHERE namespace = ?')
      .get(namespace) as { revision: number } | undefined;
    const actualRevision = current?.revision ?? null;
    if ((actualRevision ?? 0) !== expectedRevision || (actualRevision === null && expectedRevision !== 0)) {
      throw new StorageConflictError(namespace, expectedRevision, actualRevision);
    }

    const nextRevision = expectedRevision + 1;
    const updatedAt = new Date().toISOString();
    if (current) {
      this.database.prepare(`
        UPDATE memory_spaces
        SET schema_version = ?, revision = ?, current_turn = ?, block_turn_size = ?, updated_at = ?
        WHERE namespace = ?
      `).run(
        snapshot.schemaVersion,
        nextRevision,
        snapshot.currentTurn,
        snapshot.blockTurnSize,
        updatedAt,
        namespace,
      );
    } else {
      this.database.prepare(`
        INSERT INTO memory_spaces (
          namespace, schema_version, revision, current_turn, block_turn_size, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        namespace,
        snapshot.schemaVersion,
        nextRevision,
        snapshot.currentTurn,
        snapshot.blockTurnSize,
        updatedAt,
        updatedAt,
      );
    }

    const insertBlock = this.database.prepare(`
      INSERT INTO blocks (
        namespace, id, sequence, start_turn, end_turn, created_at, should_extract,
        l0_title, l0_tags_json, l1_summary, l2_keypoints_json, l3_condensed, l4_readable,
        pointer_current_level, pointer_anchor_level, pointer_anchor_turn, last_lifted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (namespace, id) DO UPDATE SET
        sequence = excluded.sequence,
        start_turn = excluded.start_turn,
        end_turn = excluded.end_turn,
        created_at = excluded.created_at,
        should_extract = excluded.should_extract,
        l0_title = excluded.l0_title,
        l0_tags_json = excluded.l0_tags_json,
        l1_summary = excluded.l1_summary,
        l2_keypoints_json = excluded.l2_keypoints_json,
        l3_condensed = excluded.l3_condensed,
        l4_readable = excluded.l4_readable,
        pointer_current_level = excluded.pointer_current_level,
        pointer_anchor_level = excluded.pointer_anchor_level,
        pointer_anchor_turn = excluded.pointer_anchor_turn,
        last_lifted_at = excluded.last_lifted_at
    `);
    for (const block of snapshot.blocks) {
      insertBlock.run(
        namespace,
        block.id,
        block.sequence,
        block.startTurn,
        block.endTurn,
        block.createdAt,
        Number(block.shouldExtract),
        block.l0Title,
        JSON.stringify(block.l0Tags),
        block.l1Summary,
        JSON.stringify(block.l2Keypoints),
        block.l3Condensed,
        block.l4Readable,
        block.pointerCurrentLevel,
        block.pointerAnchorLevel,
        block.pointerAnchorTurn,
        block.lastLiftedAt,
      );
    }

    const insertMessage = this.database.prepare(`
      INSERT INTO messages (
        namespace, id, block_id, position, role, content, created_at, tool_calls_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (namespace, id) DO UPDATE SET
        block_id = excluded.block_id,
        position = excluded.position,
        role = excluded.role,
        content = excluded.content,
        created_at = excluded.created_at,
        tool_calls_json = excluded.tool_calls_json
    `);
    const insertMessages = (messages: readonly RawMessage[], blockId: string | null): void => {
      for (const [position, message] of messages.entries()) {
        insertMessage.run(
          namespace,
          message.id,
          blockId,
          position,
          message.role,
          message.content,
          message.createdAt,
          message.toolCalls ? JSON.stringify(message.toolCalls) : null,
        );
      }
    };
    insertMessages(snapshot.openTail, null);
    for (const block of snapshot.blocks) insertMessages(block.l5Raw, block.id);

    const insertEvent = this.database.prepare(`
      INSERT INTO events (
        namespace, id, position, title, summary, narrative, tags_json, quotes_json, source_block_id,
        temporal_json, scope, criticality, confidence, status, superseded_by,
        mention_count, last_adopted_turn, last_retrieved_at, pinned, floor_weight, forced_cap,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (namespace, id) DO UPDATE SET
        position = excluded.position,
        title = excluded.title,
        summary = excluded.summary,
        narrative = excluded.narrative,
        tags_json = excluded.tags_json,
        quotes_json = excluded.quotes_json,
        source_block_id = excluded.source_block_id,
        temporal_json = excluded.temporal_json,
        scope = excluded.scope,
        criticality = excluded.criticality,
        confidence = excluded.confidence,
        status = excluded.status,
        superseded_by = excluded.superseded_by,
        mention_count = excluded.mention_count,
        last_adopted_turn = excluded.last_adopted_turn,
        last_retrieved_at = excluded.last_retrieved_at,
        pinned = excluded.pinned,
        floor_weight = excluded.floor_weight,
        forced_cap = excluded.forced_cap,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `);
    const insertEventSource = this.database.prepare(`
      INSERT INTO event_sources (namespace, event_id, message_id, position) VALUES (?, ?, ?, ?)
      ON CONFLICT (namespace, event_id, message_id) DO UPDATE SET position = excluded.position
    `);
    for (const [eventPosition, event] of snapshot.events.entries()) {
      insertEvent.run(
        namespace,
        event.id,
        eventPosition,
        event.title,
        event.summary,
        event.narrative,
        JSON.stringify(event.tags),
        JSON.stringify(event.quotes),
        event.sourceBlockId,
        JSON.stringify(event.temporal),
        event.scope,
        event.criticality,
        event.confidence,
        event.status,
        event.supersededBy,
        event.weight.mentionCount,
        event.weight.lastAdoptedTurn,
        event.weight.lastRetrievedAt,
        Number(event.weight.pinned),
        event.weight.floorWeight,
        event.weight.forcedCap,
        event.createdAt,
        event.updatedAt,
      );
      for (const [position, messageId] of event.sourceMessageIds.entries()) {
        insertEventSource.run(namespace, event.id, messageId, position);
      }
    }

    const insertElement = this.database.prepare(`
      INSERT INTO elements (
        namespace, id, position, name, type, aliases_json, current_state,
        mention_count, last_adopted_turn, last_retrieved_at, pinned, floor_weight, forced_cap,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (namespace, id) DO UPDATE SET
        position = excluded.position,
        name = excluded.name,
        type = excluded.type,
        aliases_json = excluded.aliases_json,
        current_state = excluded.current_state,
        mention_count = excluded.mention_count,
        last_adopted_turn = excluded.last_adopted_turn,
        last_retrieved_at = excluded.last_retrieved_at,
        pinned = excluded.pinned,
        floor_weight = excluded.floor_weight,
        forced_cap = excluded.forced_cap,
        updated_at = excluded.updated_at
    `);
    const insertElementSource = this.database.prepare(`
      INSERT INTO element_sources (namespace, element_id, event_id, position) VALUES (?, ?, ?, ?)
      ON CONFLICT (namespace, element_id, event_id) DO UPDATE SET position = excluded.position
    `);
    const insertElementFact = this.database.prepare(`
      INSERT INTO element_facts (
        namespace, id, element_id, position, key, mode, value_json, valid_from, valid_to,
        confidence, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (namespace, id) DO UPDATE SET
        element_id = excluded.element_id,
        position = excluded.position,
        key = excluded.key,
        mode = excluded.mode,
        value_json = excluded.value_json,
        valid_from = excluded.valid_from,
        valid_to = excluded.valid_to,
        confidence = excluded.confidence,
        status = excluded.status,
        updated_at = excluded.updated_at
    `);
    const insertElementFactSource = this.database.prepare(`
      INSERT INTO element_fact_sources (namespace, fact_id, event_id, position) VALUES (?, ?, ?, ?)
      ON CONFLICT (namespace, fact_id, event_id) DO UPDATE SET position = excluded.position
    `);
    for (const [elementPosition, element] of snapshot.elements.entries()) {
      insertElement.run(
        namespace,
        element.id,
        elementPosition,
        element.name,
        element.type,
        JSON.stringify(element.aliases),
        element.currentState,
        element.weight.mentionCount,
        element.weight.lastAdoptedTurn,
        element.weight.lastRetrievedAt,
        Number(element.weight.pinned),
        element.weight.floorWeight,
        element.weight.forcedCap,
        element.createdAt,
        element.updatedAt,
      );
      for (const [position, eventId] of element.sourceEventIds.entries()) {
        insertElementSource.run(namespace, element.id, eventId, position);
      }
      for (const [factPosition, fact] of element.facts.entries()) {
        insertElementFact.run(
          namespace,
          fact.id,
          element.id,
          factPosition,
          fact.key,
          fact.mode,
          JSON.stringify(fact.value),
          fact.validFrom ?? null,
          fact.validTo ?? null,
          fact.confidence ?? null,
          fact.status,
          fact.createdAt,
          fact.updatedAt,
        );
        for (const [position, eventId] of fact.sourceEventIds.entries()) {
          insertElementFactSource.run(namespace, fact.id, eventId, position);
        }
      }
    }

    const insertJob = this.database.prepare(`
      INSERT INTO extraction_jobs (
        namespace, block_id, status, attempts, last_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (namespace, block_id) DO UPDATE SET
        status = excluded.status,
        attempts = excluded.attempts,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `);
    for (const job of snapshot.extractionJobs) {
      insertJob.run(namespace, job.blockId, job.status, job.attempts, job.lastError, job.updatedAt);
    }

    const insertElementProjectionJob = this.database.prepare(`
      INSERT INTO element_projection_jobs (
        namespace, id, source_event_ids_json, status, attempts, element_ids_json,
        reason, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (namespace, id) DO UPDATE SET
        source_event_ids_json = excluded.source_event_ids_json,
        status = excluded.status,
        attempts = excluded.attempts,
        element_ids_json = excluded.element_ids_json,
        reason = excluded.reason,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `);
    for (const job of snapshot.elementProjectionJobs) {
      insertElementProjectionJob.run(
        namespace,
        job.id,
        JSON.stringify(job.sourceEventIds),
        job.status,
        job.attempts,
        JSON.stringify(job.elementIds),
        job.reason,
        job.lastError,
        job.createdAt,
        job.updatedAt,
      );
    }

    const insertReceipt = this.database.prepare(`
      INSERT INTO usage_receipts (namespace, receipt_id, event_ids_json, element_ids_json, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (namespace, receipt_id) DO NOTHING
    `);
    for (const receipt of snapshot.usageReceipts) {
      insertReceipt.run(
        namespace,
        receipt.id,
        JSON.stringify(receipt.eventIds),
        JSON.stringify(receipt.elementIds),
        receipt.createdAt,
      );
    }

    return nextRevision;
  }

  private migrate(): void {
    const version = this.database.pragma('user_version', { simple: true }) as number;
    if (version > STRATAGATE_STORAGE_SCHEMA_VERSION) {
      throw new Error(`SQLite schema ${version} is newer than supported schema ${STRATAGATE_STORAGE_SCHEMA_VERSION}`);
    }
    if (version === 0) {
      const migrate = this.database.transaction(() => {
        this.database.exec(SCHEMA);
        this.database.pragma(`user_version = ${STRATAGATE_STORAGE_SCHEMA_VERSION}`);
      });
      migrate.immediate();
    } else if (version === 1) {
      const migrate = this.database.transaction(() => {
        const receiptColumns = this.database.pragma('table_info(usage_receipts)') as Array<{ name: string }>;
        if (!receiptColumns.some(({ name }) => name === 'element_ids_json')) {
          this.database.exec("ALTER TABLE usage_receipts ADD COLUMN element_ids_json TEXT NOT NULL DEFAULT '[]'");
        }
        this.database.exec(SCHEMA);
        this.database.prepare('UPDATE memory_spaces SET schema_version = ? WHERE schema_version = 1')
          .run(STRATAGATE_STORAGE_SCHEMA_VERSION);
        this.database.pragma(`user_version = ${STRATAGATE_STORAGE_SCHEMA_VERSION}`);
      });
      migrate.immediate();
    }
    this.assertSchemaVersion();
  }

  private assertSchemaVersion(): void {
    const version = this.database.pragma('user_version', { simple: true }) as number;
    if (version !== STRATAGATE_STORAGE_SCHEMA_VERSION) {
      throw new Error(`Unsupported SQLite schema version: ${version}`);
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('SQLite storage is closed');
  }
}
