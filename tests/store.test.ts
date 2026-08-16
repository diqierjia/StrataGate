import { describe, expect, it } from 'vitest';
import { StrataGate, memoryWeightAt, type BlockSummarizer, type EventExtractor } from '../src/index.js';

function ids(): (prefix: 'msg' | 'blk' | 'evt') => string {
  let value = 0;
  return (prefix) => `${prefix}_${++value}`;
}

const summarizer: BlockSummarizer = async (messages) => ({
  l0Title: messages[0]?.content.slice(0, 40) ?? 'block',
  l0Tags: ['test'],
  l1Summary: messages.map((message) => message.content).join(' '),
  l2Keypoints: messages.map((message) => message.content),
  shouldExtract: true,
});

const extractor: EventExtractor = async ({ target }) => ({
  shouldExtract: true,
  reason: 'stable preference',
  events: [{
    title: 'Prefers concise answers',
    summary: 'The user asked for concise answers.',
    tags: ['preference', 'writing'],
    quotes: ['Please keep answers concise.'],
    sourceMessageIds: [target.l5Raw[0]?.id ?? 'missing'],
    sourceBlockId: target.id,
    criticality: 'preference',
    temporal: { happenedStart: '2026-01-01', participants: ['user'], eventType: 'preference' },
  }],
});

describe('StrataGate lifecycle', () => {
  it('rejects implicit construction so ephemeral storage stays explicit', () => {
    const UnsafeConstructor = StrataGate as unknown as new () => StrataGate;
    expect(() => new UnsafeConstructor()).toThrow('Use StrataGate.open() for SQLite');
  });

  it('seals blocks, delays extraction, searches, and records adoption separately', async () => {
    const memory = StrataGate.inMemory({ blockTurnSize: 1, summarizer, extractor, idFactory: ids() });
    const first = await memory.appendTurn({ user: 'Please keep answers concise.', assistant: 'Understood.' });
    expect(first.sealedBlock).not.toBeNull();
    expect(first.extractedEvents).toHaveLength(0);

    const second = await memory.appendTurn({ user: 'What did I ask?', assistant: 'Let me check.' });
    expect(second.extractedEvents).toHaveLength(1);
    const result = await memory.searchEvents('concise writing preference');
    expect(result[0]?.event.title).toBe('Prefers concise answers');

    const event = result[0]?.event;
    expect(event).toBeDefined();
    if (!event) return;
    const before = event.weight.mentionCount;
    await memory.searchEvents('concise');
    expect(event.weight.mentionCount).toBe(before);
    await memory.recordMemoryUse([event.id]);
    expect(event.weight.mentionCount).toBe(before + 1);
    expect(memoryWeightAt(event, memory.turn)).toBe(1);
  });

  it('keeps forgotten events out of search without deleting their provenance', async () => {
    const memory = StrataGate.inMemory({ blockTurnSize: 1, summarizer, extractor, idFactory: ids() });
    await memory.appendTurn({ user: 'Please keep answers concise.', assistant: 'Understood.' });
    await memory.appendTurn({ user: 'What did I ask?', assistant: 'Let me check.' });
    const event = memory.listEvents()[0];
    expect(event).toBeDefined();
    if (!event) return;
    await memory.forgetEvent(event.id);
    expect(await memory.searchEvents('concise')).toHaveLength(0);
    expect(memory.listEvents()[0]?.sourceMessageIds.length).toBeGreaterThan(0);
  });
});
