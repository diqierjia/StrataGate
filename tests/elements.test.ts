import { describe, expect, it } from 'vitest';
import {
  StrataGate,
  type BlockSummarizer,
  type ElementProjector,
  type EventExtractor,
} from '../src/index.js';

function ids(): (prefix: 'msg' | 'blk' | 'evt') => string {
  let value = 0;
  return (prefix) => `${prefix}_${++value}`;
}

function elementIds(): (prefix: 'elem' | 'fact' | 'proj') => string {
  let value = 0;
  return (prefix) => `${prefix}_${++value}`;
}

const summarizer: BlockSummarizer = async (messages) => ({
  l0Title: messages[0]?.content ?? 'block',
  l0Tags: ['project'],
  l1Summary: messages.map(({ content }) => content).join(' '),
  l2Keypoints: messages.map(({ content }) => content),
  shouldExtract: true,
});

const extractor: EventExtractor = async ({ target }) => ({
  shouldExtract: true,
  reason: 'project state changed',
  events: [{
    title: 'Database decision',
    summary: target.l5Raw[0]?.content ?? 'unknown',
    sourceMessageIds: [target.l5Raw[0]?.id ?? 'missing'],
    sourceBlockId: target.id,
    temporal: {
      happenedStart: target.l5Raw[0]?.createdAt ?? target.createdAt,
      participants: ['StrataGate'],
      eventType: 'decision',
    },
  }],
});

const projector: ElementProjector = async ({ events }) => ({
  reason: 'materialize the project database state',
  changes: events.map((event) => ({
    element: { name: 'StrataGate', type: 'project', aliases: ['SG'] },
    operation: 'set_state',
    key: 'database',
    mode: 'state',
    value: event.summary,
    validFrom: event.temporal.happenedStart ?? event.createdAt,
    sourceEventIds: [event.id],
    confidence: 0.95,
  })),
});

describe('element projection and retrieval', () => {
  it('projects elements independently, preserves event history, and exposes time views', async () => {
    const memory = new StrataGate({
      blockTurnSize: 1,
      summarizer,
      extractor,
      elementProjector: projector,
      idFactory: ids(),
      elementIdFactory: elementIds(),
    });
    await memory.appendTurn({
      user: 'The project database is SQLite.',
      assistant: 'Recorded.',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const second = await memory.appendTurn({
      user: 'The project database is PostgreSQL.',
      assistant: 'Updated.',
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    expect(second.projectedElements).toHaveLength(1);
    const immutableFirstEvent = structuredClone(memory.listEvents()[0]);

    await memory.appendTurn({
      user: 'Confirm the current database.',
      assistant: 'Checking.',
      createdAt: '2026-03-01T00:00:00.000Z',
    });

    expect(memory.listEvents()[0]).toEqual(immutableFirstEvent);
    const element = memory.listElements()[0];
    expect(element?.currentState).toContain('PostgreSQL');
    expect(element?.facts.map(({ status }) => status)).toEqual(['superseded', 'active']);
    if (!element) return;
    expect(memory.expandElement(element.id, '2026-01-15T00:00:00.000Z').currentState).toContain('SQLite');
    expect(memory.expandElement(element.id, '2026-02-15T00:00:00.000Z').currentState).toContain('PostgreSQL');
  });

  it('retrieves fact-level element evidence with BM25 plus structured rankings', async () => {
    const memory = new StrataGate({
      blockTurnSize: 1,
      summarizer,
      extractor,
      elementProjector: projector,
      idFactory: ids(),
      elementIdFactory: elementIds(),
    });
    await memory.appendTurn({ user: 'The project database is SQLite.', assistant: 'Recorded.' });
    await memory.appendTurn({ user: 'Continue.', assistant: 'Okay.' });

    expect((await memory.searchElements('SQLite database'))[0]).toMatchObject({
      name: 'StrataGate',
      type: 'project',
    });
    expect(await memory.searchElements('watermelon')).toEqual([]);
    expect(await memory.searchElements('', { type: 'project' })).toHaveLength(1);
    expect(await memory.searchEvents('watermelon')).toEqual([]);
    expect(await memory.searchEvents('', { participants: ['StrataGate'] })).toHaveLength(1);
  });

  it('retries only a failed projection and rejects facts without batch provenance', async () => {
    const memory = new StrataGate({
      blockTurnSize: 1,
      summarizer,
      idFactory: ids(),
      elementIdFactory: elementIds(),
    });
    await memory.appendTurn({ user: 'source', assistant: 'stored' });
    const block = memory.listBlocks()[0];
    expect(block).toBeDefined();
    if (!block) return;
    const event = await memory.addEvent({
      title: 'Source event',
      summary: 'Auditable source',
      sourceBlockId: block.id,
      sourceMessageIds: [block.l5Raw[0]?.id ?? 'missing'],
    });
    const firstClaim = await memory.claimNextElementProjection();
    expect(firstClaim?.events.map(({ id }) => id)).toEqual([event.id]);
    if (!firstClaim) return;
    await memory.failElementProjection(firstClaim.jobId, new Error('temporary failure'));
    const retry = await memory.claimNextElementProjection();
    expect(retry?.jobId).toBe(firstClaim.jobId);
    expect(memory.listElementProjectionJobs()[0]?.attempts).toBe(2);
    if (!retry) return;
    const projected = await memory.completeElementProjection(retry.jobId, {
      reason: 'invalid provenance is ignored',
      changes: [{
        element: { name: 'StrataGate', type: 'project' },
        operation: 'set_state',
        key: 'database',
        mode: 'state',
        value: 'must not land',
        sourceEventIds: [event.id, 'event_outside_batch'],
      }],
    });
    expect(projected).toEqual([]);
    expect(memory.listEvents()).toHaveLength(1);
    expect(memory.listElements()).toHaveLength(0);
  });
});
