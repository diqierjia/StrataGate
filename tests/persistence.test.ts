import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  StorageConflictError,
  StrataGate,
  type BlockSummarizer,
  type EventExtractor,
} from '../src/index.js';
import { SqliteStorage } from '../src/sqlite.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'stratagate-'));
  temporaryDirectories.push(directory);
  return join(directory, 'memory.db');
}

function ids(): (prefix: 'msg' | 'blk' | 'evt') => string {
  let value = 0;
  return (prefix) => `${prefix}_${++value}`;
}

const fixedNow = (): Date => new Date('2026-08-12T00:00:00.000Z');

const summarizer: BlockSummarizer = async (messages) => ({
  l0Title: messages[0]?.content ?? 'block',
  l0Tags: ['persistent'],
  l1Summary: messages.map((message) => message.content).join(' '),
  l2Keypoints: messages.map((message) => message.content),
  shouldExtract: true,
});

const extractor: EventExtractor = async ({ target }) => ({
  shouldExtract: true,
  reason: 'durable preference',
  events: [{
    id: `event_for_${target.id}`,
    title: 'Persistent preference',
    summary: target.l5Raw[0]?.content ?? 'preference',
    sourceMessageIds: [target.l5Raw[0]?.id ?? 'missing'],
    sourceBlockId: target.id,
    criticality: 'preference',
  }],
});

describe('SQLite persistence', () => {
  it('uses SQLite for the normal open entrypoint and keeps memory mode explicit', async () => {
    const filename = await databasePath();
    const persistent = await StrataGate.open({
      database: filename,
      namespace: 'default:sqlite',
      now: fixedNow,
      idFactory: ids(),
    });
    expect(persistent.storageRevision).toBe(1);
    await persistent.appendTurn({ user: 'stored', assistant: 'durably' });
    expect(persistent.storageRevision).toBe(2);
    await persistent.close();

    const database = new Database(filename, { readonly: true });
    expect(database.prepare('SELECT current_turn FROM memory_spaces WHERE namespace = ?')
      .pluck().get('default:sqlite')).toBe(1);
    database.close();

    const ephemeral = StrataGate.inMemory({ now: fixedNow, idFactory: ids() });
    expect(ephemeral.storageRevision).toBe(0);
    await ephemeral.appendTurn({ user: 'temporary', assistant: 'only' });
    expect(ephemeral.storageRevision).toBe(0);
  });

  it('creates schema version four and rejects a newer database schema', async () => {
    const initializedFilename = await databasePath();
    const initialized = new SqliteStorage({ filename: initializedFilename });
    await initialized.close();
    const initializedDatabase = new Database(initializedFilename, { readonly: true });
    expect(initializedDatabase.pragma('user_version', { simple: true })).toBe(4);
    initializedDatabase.close();

    const newerFilename = await databasePath();
    const newerDatabase = new Database(newerFilename);
    newerDatabase.pragma('user_version = 5');
    newerDatabase.close();
    expect(() => new SqliteStorage({ filename: newerFilename })).toThrow('newer than supported');
  });

  it('restores an open tail and seals it at the same boundary after restart', async () => {
    const filename = await databasePath();
    const idFactory = ids();
    const first = await StrataGate.open({
      database: filename,
      namespace: 'user:alice',
      blockTurnSize: 2,
      summarizer,
      idFactory,
      now: fixedNow,
    });
    await first.appendTurn({ user: 'turn one', assistant: 'answer one' });
    expect(first.listOpenTail()).toHaveLength(2);
    await first.close();

    const second = await StrataGate.open({
      database: filename,
      namespace: 'user:alice',
      summarizer,
      idFactory,
      now: fixedNow,
    });
    expect(second.turn).toBe(1);
    expect(second.listOpenTail().map((message) => message.content)).toEqual(['turn one', 'answer one']);
    const result = await second.appendTurn({ user: 'turn two', assistant: 'answer two' });
    expect(result.sealedBlock?.startTurn).toBe(1);
    expect(result.sealedBlock?.endTurn).toBe(2);
    expect(second.listOpenTail()).toHaveLength(0);
    const expected = second.exportSnapshot();
    await second.close();

    const restored = await StrataGate.open({
      database: filename,
      namespace: 'user:alice',
      summarizer,
      idFactory,
      now: fixedNow,
    });
    expect(restored.exportSnapshot()).toEqual(expected);
    await restored.close();
  });

  it('keeps raw turns durable when summarization fails and resumes without appending again', async () => {
    const filename = await databasePath();
    const failingSummary: BlockSummarizer = async () => {
      throw new Error('summary unavailable');
    };
    const first = await StrataGate.open({
      database: filename,
      namespace: 'session:summary-retry',
      blockTurnSize: 1,
      summarizer: failingSummary,
      now: fixedNow,
      idFactory: ids(),
    });
    await expect(first.appendTurn({ user: 'must survive', assistant: 'stored first' }))
      .rejects.toThrow('summary unavailable');
    expect(first.turn).toBe(1);
    expect(first.listOpenTail()).toHaveLength(2);
    expect(first.listBlocks()).toHaveLength(0);
    await first.close();

    const restored = await StrataGate.open({
      database: filename,
      namespace: 'session:summary-retry',
      summarizer,
      now: fixedNow,
      idFactory: ids(),
    });
    const resumed = await restored.resumePendingWork();
    expect(resumed.sealedBlocks).toHaveLength(1);
    expect(restored.listBlocks()[0]?.l5Raw[0]?.content).toBe('must survive');
    expect(restored.turn).toBe(1);
    await restored.close();
  });

  it('persists failed extraction and retries only that eligible block', async () => {
    const filename = await databasePath();
    let attempts = 0;
    const failingExtractor: EventExtractor = async () => {
      attempts += 1;
      throw new Error('extractor unavailable');
    };
    const idFactory = ids();
    const first = await StrataGate.open({
      database: filename,
      namespace: 'session:extract-retry',
      blockTurnSize: 1,
      summarizer,
      extractor: failingExtractor,
      now: fixedNow,
      idFactory,
    });
    await first.appendTurn({ user: 'remember this', assistant: 'okay' });
    await expect(first.appendTurn({ user: 'later context', assistant: 'noted' }))
      .rejects.toThrow('extractor unavailable');
    expect(attempts).toBe(1);
    expect(first.listBlocks()).toHaveLength(2);
    expect(first.listEvents()).toHaveLength(0);
    expect(first.listExtractionJobs()).toMatchObject([{
      status: 'failed',
      attempts: 1,
      lastError: 'extractor unavailable',
    }]);
    await first.close();

    const restored = await StrataGate.open({
      database: filename,
      namespace: 'session:extract-retry',
      summarizer,
      extractor,
      now: fixedNow,
      idFactory,
    });
    const resumed = await restored.resumePendingWork();
    expect(resumed.extractedEvents).toHaveLength(1);
    expect(restored.listEvents()).toHaveLength(1);
    expect(restored.listExtractionJobs()).toMatchObject([{
      status: 'succeeded',
      attempts: 2,
      lastError: null,
    }]);
    await restored.close();
  });

  it('makes adoption receipts idempotent across retries and restarts', async () => {
    const filename = await databasePath();
    const idFactory = ids();
    const first = await StrataGate.open({
      database: filename,
      namespace: 'user:receipts',
      blockTurnSize: 1,
      summarizer,
      extractor,
      now: fixedNow,
      idFactory,
    });
    await first.appendTurn({ user: 'prefer short answers', assistant: 'okay' });
    await first.appendTurn({ user: 'what is my preference?', assistant: 'checking' });
    const event = first.listEvents()[0];
    expect(event).toBeDefined();
    if (!event) return;
    const audit = {
      sessionId: 'session-42',
      turn: 7,
      batchId: 'batch_1',
      evidenceRefs: [`event:${event.id}`],
      verdict: 'sufficient' as const,
      fit: 'The event directly supports the answer.',
      missing: '',
      nextStrategy: 'answer',
    };
    await first.recordMemoryUse([event.id], { receiptId: 'answer:42', audit });
    await first.recordMemoryUse([event.id], { receiptId: 'answer:42', audit });
    expect(event.weight.mentionCount).toBe(2);
    await first.close();

    const restored = await StrataGate.open({
      database: filename,
      namespace: 'user:receipts',
      summarizer,
      extractor,
      now: fixedNow,
      idFactory,
    });
    const restoredEvent = restored.listEvents()[0];
    expect(restoredEvent?.weight.mentionCount).toBe(2);
    if (restoredEvent) {
      expect(restored.listUsageReceipts()).toContainEqual(expect.objectContaining({
        id: 'answer:42',
        audit,
      }));
      await restored.recordMemoryUse([restoredEvent.id], { receiptId: 'answer:42', audit });
      expect(restoredEvent.weight.mentionCount).toBe(2);
      await expect(restored.recordMemoryUse([], { receiptId: 'answer:42' }))
        .rejects.toThrow('different memory IDs');
    }
    await restored.close();
  });

  it('rejects a stale writer and rolls back its in-memory mutation', async () => {
    const filename = await databasePath();
    const first = await StrataGate.open({
      database: filename,
      namespace: 'project:shared',
      blockTurnSize: 12,
      now: fixedNow,
      idFactory: ids(),
    });
    const stale = await StrataGate.open({
      database: filename,
      namespace: 'project:shared',
      now: fixedNow,
      idFactory: ids(),
    });

    await first.appendTurn({ user: 'writer one', assistant: 'committed' });
    await expect(stale.appendTurn({ user: 'writer two', assistant: 'stale' }))
      .rejects.toBeInstanceOf(StorageConflictError);
    expect(stale.turn).toBe(0);
    expect(stale.listOpenTail()).toHaveLength(0);
    await first.close();
    await stale.close();
  });

  it('migrates a schema-v1 database in place without losing its namespace', async () => {
    const filename = await databasePath();
    const legacy = new Database(filename);
    legacy.exec(`
      CREATE TABLE memory_spaces (
        namespace TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        current_turn INTEGER NOT NULL,
        block_turn_size INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE usage_receipts (
        namespace TEXT NOT NULL,
        receipt_id TEXT NOT NULL,
        event_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (namespace, receipt_id),
        FOREIGN KEY (namespace) REFERENCES memory_spaces(namespace) ON DELETE CASCADE
      ) STRICT;
      INSERT INTO memory_spaces VALUES ('legacy:user', 1, 7, 0, 12, '2026-01-01', '2026-01-01');
      PRAGMA user_version = 1;
    `);
    legacy.close();

    const storage = new SqliteStorage({ filename });
    const loaded = await storage.load('legacy:user');
    expect(loaded?.revision).toBe(7);
    expect(loaded?.snapshot).toMatchObject({
      schemaVersion: 4,
      elements: [],
      elementProjectionJobs: [],
      ingestionReceipts: [],
    });
    await storage.close();

    const migrated = new Database(filename, { readonly: true });
    expect(migrated.pragma('user_version', { simple: true })).toBe(4);
    expect((migrated.pragma('table_info(usage_receipts)') as Array<{ name: string }>)
      .map(({ name }) => name)).toContain('element_ids_json');
    expect((migrated.pragma('table_info(usage_receipts)') as Array<{ name: string }>)
      .map(({ name }) => name)).toContain('audit_json');
    expect(migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'elements'")
      .pluck().get()).toBe('elements');
    expect(migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ingestion_receipts'")
      .pluck().get()).toBe('ingestion_receipts');
    migrated.close();
  });

  it('persists projected elements and idempotent element-use receipts across restarts', async () => {
    const filename = await databasePath();
    const storage = new SqliteStorage({ filename });
    const elementIdFactory = (() => {
      let value = 0;
      return (prefix: 'elem' | 'fact' | 'proj') => `${prefix}_${++value}`;
    })();
    const first = await StrataGate.openWithStorage({
      storage,
      namespace: 'project:elements',
      blockTurnSize: 1,
      summarizer,
      extractor,
      idFactory: ids(),
      elementIdFactory,
      elementProjector: async ({ events }) => ({
        reason: 'project current state',
        changes: [{
          element: { name: 'StrataGate', type: 'project' },
          operation: 'set_state',
          key: 'storage',
          mode: 'state',
          value: 'SQLite',
          sourceEventIds: [events[0]?.id ?? 'missing'],
        }],
      }),
      now: fixedNow,
    });
    await first.appendTurn({ user: 'Use SQLite.', assistant: 'Recorded.' });
    await first.appendTurn({ user: 'Continue.', assistant: 'Okay.' });
    const element = first.listElements()[0];
    expect(element?.currentState).toContain('SQLite');
    if (!element) return;
    await first.recordMemoryUse({ elementIds: [element.id] }, { receiptId: 'answer:element:1' });
    await first.recordMemoryUse({ elementIds: [element.id] }, { receiptId: 'answer:element:1' });
    expect(element.weight.mentionCount).toBe(2);
    await first.close();

    const restoredStorage = new SqliteStorage({ filename });
    const restored = await StrataGate.openWithStorage({ storage: restoredStorage, namespace: 'project:elements' });
    expect(restored.listElements()[0]).toMatchObject({
      name: 'StrataGate',
      currentState: 'storage: SQLite',
      weight: { mentionCount: 2 },
    });
    expect(restored.listElementProjectionJobs()[0]?.status).toBe('completed');
    await restored.close();
  });
});
