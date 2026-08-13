export const RETRIEVAL_CONTRACT_VERSION = 5;

export const RETRIEVAL_STRATEGIES = [
  'answer',
  'search_events',
  'expand_event',
  'search_elements',
  'expand_element',
  'search_raw_memory',
  'expand_block',
] as const;

export type RetrievalVerdict = 'sufficient' | 'partial' | 'wrong';
export type RetrievalStrategy = typeof RETRIEVAL_STRATEGIES[number];

export interface RetrievalAssessment {
  verdict: RetrievalVerdict;
  evidenceRefs: string[];
  fit: string;
  missing: string;
  nextStrategy: RetrievalStrategy;
}

export interface RetrievalAssessmentInput {
  verdict?: unknown;
  evidence_refs?: unknown;
  fit?: unknown;
  missing?: unknown;
  next_strategy?: unknown;
}

export const RETRIEVAL_ASSESSMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['sufficient', 'partial', 'wrong'] },
    evidence_refs: { type: 'array', maxItems: 8, items: { type: 'string' } },
    fit: { type: 'string', maxLength: 160 },
    missing: { type: 'string', maxLength: 160 },
    next_strategy: { type: 'string', enum: RETRIEVAL_STRATEGIES },
  },
  required: ['verdict', 'evidence_refs', 'fit', 'missing', 'next_strategy'],
} as const;

function shortText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 160) : '';
}

function normalizeStrategy(value: unknown): RetrievalStrategy {
  return typeof value === 'string' && (RETRIEVAL_STRATEGIES as readonly string[]).includes(value)
    ? value as RetrievalStrategy
    : 'search_events';
}

/**
 * The gate rejects a "sufficient" decision unless it points to evidence from
 * the latest retrieval batch and explicitly selects the answer step.
 */
export function normalizeRetrievalAssessment(
  input: RetrievalAssessmentInput,
  latestEvidenceRefs: ReadonlySet<string>,
): RetrievalAssessment {
  const requestedVerdict: RetrievalVerdict = input.verdict === 'sufficient' || input.verdict === 'wrong'
    ? input.verdict
    : 'partial';
  const evidenceRefs = Array.isArray(input.evidence_refs)
    ? [...new Set(input.evidence_refs.filter((id): id is string => typeof id === 'string' && latestEvidenceRefs.has(id)))].slice(0, 8)
    : [];
  const requestedStrategy = normalizeStrategy(input.next_strategy);
  const sufficient = requestedVerdict === 'sufficient' && evidenceRefs.length > 0 && requestedStrategy === 'answer';

  return {
    verdict: sufficient ? 'sufficient' : requestedVerdict === 'wrong' ? 'wrong' : 'partial',
    evidenceRefs,
    fit: shortText(input.fit),
    missing: sufficient ? '' : shortText(input.missing) || 'Direct evidence required to answer the question is still missing.',
    nextStrategy: sufficient ? 'answer' : requestedStrategy === 'answer' ? 'search_events' : requestedStrategy,
  };
}
