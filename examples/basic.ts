import { StrataGate, type BlockSummarizer, type EventExtractor } from '../src/index.js';

const summarize: BlockSummarizer = async (messages) => ({
  l0Title: 'API design discussion',
  l0Tags: ['api', 'decision'],
  l1Summary: 'The team chose cursor pagination for the public API.',
  l2Keypoints: messages.map((message) => message.content),
  shouldExtract: true,
});

const extract: EventExtractor = async ({ target }) => ({
  shouldExtract: true,
  reason: 'A durable technical decision was made.',
  events: [{
    title: 'Use cursor pagination',
    summary: 'The public API should use cursor pagination instead of page numbers.',
    sourceMessageIds: target.l5Raw.filter((message) => message.role === 'user').map((message) => message.id),
    sourceBlockId: target.id,
    tags: ['api', 'pagination'],
    temporal: { status: 'occurred', eventType: 'decision' },
  }],
});

const memory = new StrataGate({ blockTurnSize: 1, summarizer: summarize, extractor: extract });

await memory.appendTurn({
  user: 'Let us use cursor pagination for the public API.',
  assistant: 'Agreed. I will treat that as the current API decision.',
});

// Extraction waits until the following block exists, so it can use both
// earlier and later context without taking quotes from neighboring blocks.
await memory.appendTurn({
  user: 'Now define the response envelope.',
  assistant: 'I will keep the pagination decision in mind.',
});

const results = memory.searchEvents('How should the API paginate?');
const evidence = new Set(results.map(({ event }) => event.id));
const assessment = memory.assessRetrieval({
  verdict: 'sufficient',
  evidence_refs: [...evidence],
  fit: 'The event card records the chosen pagination strategy.',
  missing: '',
  next_strategy: 'answer',
}, evidence);

if (assessment.verdict === 'sufficient') {
  memory.recordMemoryUse(assessment.evidenceRefs);
  console.log(results[0]?.event.summary);
}
