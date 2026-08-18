import type { ElementCard, EventCard, MemoryBlock, RawMessage } from './types.js';

export const STRATAGATE_STORAGE_SCHEMA_VERSION = 4;

export type ExtractionJobStatus = 'running' | 'succeeded' | 'skipped' | 'failed';

export interface ExtractionJob {
  blockId: string;
  status: ExtractionJobStatus;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
}

export type ElementProjectionJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ElementProjectionJob {
  id: string;
  sourceEventIds: string[];
  status: ElementProjectionJobStatus;
  attempts: number;
  elementIds: string[];
  reason: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UsageReceipt {
  id: string;
  eventIds: string[];
  elementIds: string[];
  audit?: UsageAudit;
  createdAt: string;
}

export interface UsageAudit {
  sessionId?: string;
  turn?: number;
  batchId?: string;
  evidenceRefs?: string[];
  verdict?: 'sufficient' | 'partial' | 'wrong';
  fit?: string;
  missing?: string;
  nextStrategy?: string;
}

export interface IngestionReceipt {
  id: string;
  createdAt: string;
}

export interface StrataGateSnapshot {
  schemaVersion: typeof STRATAGATE_STORAGE_SCHEMA_VERSION;
  currentTurn: number;
  blockTurnSize: number;
  openTail: RawMessage[];
  blocks: MemoryBlock[];
  events: EventCard[];
  elements: ElementCard[];
  extractionJobs: ExtractionJob[];
  elementProjectionJobs: ElementProjectionJob[];
  usageReceipts: UsageReceipt[];
  ingestionReceipts: IngestionReceipt[];
}

export interface LoadedStrataGateState {
  snapshot: StrataGateSnapshot;
  revision: number;
}

export interface StorageAdapter {
  load(namespace: string): Promise<LoadedStrataGateState | null>;
  save(namespace: string, snapshot: StrataGateSnapshot, expectedRevision: number): Promise<number>;
  close?(): Promise<void>;
}

export class StorageConflictError extends Error {
  constructor(
    readonly namespace: string,
    readonly expectedRevision: number,
    readonly actualRevision: number | null,
  ) {
    super(`Storage revision conflict for ${namespace}: expected ${expectedRevision}, found ${actualRevision ?? 'missing'}`);
    this.name = 'StorageConflictError';
  }
}

export function cloneSnapshot(snapshot: StrataGateSnapshot): StrataGateSnapshot {
  return structuredClone(snapshot);
}

interface LegacySnapshotV1 extends Omit<StrataGateSnapshot, 'schemaVersion' | 'elements' | 'elementProjectionJobs' | 'usageReceipts' | 'ingestionReceipts'> {
  schemaVersion: 1;
  usageReceipts: Array<Omit<UsageReceipt, 'elementIds'>>;
}

interface LegacySnapshotV2 extends Omit<StrataGateSnapshot, 'schemaVersion' | 'ingestionReceipts'> {
  schemaVersion: 2;
}

interface LegacySnapshotV3 extends Omit<StrataGateSnapshot, 'schemaVersion' | 'usageReceipts'> {
  schemaVersion: 3;
  usageReceipts: Array<Omit<UsageReceipt, 'audit'>>;
}

export function normalizeSnapshot(value: unknown): StrataGateSnapshot {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid StrataGate snapshot: expected an object');
  const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  let snapshot: StrataGateSnapshot;
  if (schemaVersion === 1) {
    const legacy = value as LegacySnapshotV1;
    snapshot = {
      ...structuredClone(legacy),
      schemaVersion: STRATAGATE_STORAGE_SCHEMA_VERSION,
      elements: [],
      elementProjectionJobs: [],
      usageReceipts: Array.isArray(legacy.usageReceipts)
        ? legacy.usageReceipts.map((receipt) => ({ ...receipt, elementIds: [] }))
        : [],
      ingestionReceipts: [],
    };
  } else if (schemaVersion === 2) {
    snapshot = {
      ...structuredClone(value as LegacySnapshotV2),
      schemaVersion: STRATAGATE_STORAGE_SCHEMA_VERSION,
      ingestionReceipts: [],
    };
  } else if (schemaVersion === 3) {
    snapshot = {
      ...structuredClone(value as LegacySnapshotV3),
      schemaVersion: STRATAGATE_STORAGE_SCHEMA_VERSION,
    };
  } else if (schemaVersion === STRATAGATE_STORAGE_SCHEMA_VERSION) {
    snapshot = structuredClone(value) as StrataGateSnapshot;
  } else {
    throw new TypeError(`Unsupported StrataGate snapshot schema: ${String(schemaVersion)}`);
  }
  if (!Number.isSafeInteger(snapshot.currentTurn) || (snapshot.currentTurn ?? -1) < 0) {
    throw new TypeError('Invalid StrataGate snapshot: currentTurn must be a non-negative integer');
  }
  if (!Number.isSafeInteger(snapshot.blockTurnSize) || (snapshot.blockTurnSize ?? 0) < 1) {
    throw new TypeError('Invalid StrataGate snapshot: blockTurnSize must be a positive integer');
  }
  for (const key of ['openTail', 'blocks', 'events', 'elements', 'extractionJobs', 'elementProjectionJobs', 'usageReceipts', 'ingestionReceipts'] as const) {
    if (!Array.isArray(snapshot[key])) throw new TypeError(`Invalid StrataGate snapshot: ${key} must be an array`);
  }
  return snapshot;
}

export function assertValidSnapshot(value: unknown): asserts value is StrataGateSnapshot {
  normalizeSnapshot(value);
}
