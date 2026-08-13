import {
  StrataGate,
  type BlockSummarizer,
  type ElementProjector,
  type EventExtractor,
} from '../src/index.js';

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

// Element cards are a separately retryable materialized view. The callback may
// call any model provider; StrataGate validates every proposed source event ID.
const projectElements: ElementProjector = async ({ events }) => ({
  reason: 'Update the current project view from the new immutable event.',
  changes: events.map((event) => ({
    element: { name: 'Public API', type: 'project' },
    operation: 'set_state',
    key: 'pagination',
    mode: 'state',
    value: 'cursor pagination',
    sourceEventIds: [event.id],
    confidence: 1,
  })),
});

const memory = new StrataGate({
  blockTurnSize: 1,
  summarizer: summarize,
  extractor: extract,
  elementProjector: projectElements,
});

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

const results = await memory.searchEvents('How should the API paginate?');
const elementFacts = await memory.searchElements('current API pagination', { type: 'project' });
const evidence = new Set([
  ...results.map(({ event }) => event.id),
  ...elementFacts.map(({ id }) => id),
]);
const assessment = memory.assessRetrieval({
  verdict: 'sufficient',
  evidence_refs: [...evidence],
  fit: 'The event card records the chosen pagination strategy.',
  missing: '',
  next_strategy: 'answer',
}, evidence);

if (assessment.verdict === 'sufficient') {
  await memory.recordMemoryUse({
    eventIds: results.map(({ event }) => event.id),
    elementIds: [...new Set(elementFacts.map(({ elementId }) => elementId))],
  });
  console.log(elementFacts[0]?.fact.value ?? results[0]?.event.summary);
}
