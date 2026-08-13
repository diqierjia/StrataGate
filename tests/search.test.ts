import { describe, expect, it } from 'vitest';
import { bm25Rank, rrfRank, searchTokens, weightedSearchTokens } from '../src/index.js';

describe('auditable hybrid ranking', () => {
  const documents = [
    { id: 'alpha', title: 'PostgreSQL migration', body: 'Move the project database to PostgreSQL.' },
    { id: 'beta', title: 'Design review', body: 'Review the application layout.' },
  ];

  it('uses BM25 lexical ranking and returns no candidates on a real zero match', () => {
    const ranked = bm25Rank(documents, 'PostgreSQL database', (item) =>
      weightedSearchTokens([[item.title, 3], [item.body, 1]]));
    expect(ranked.map(({ item }) => item.id)).toEqual(['alpha']);
    expect(bm25Rank(documents, 'watermelon', (item) => searchTokens(`${item.title} ${item.body}`))).toEqual([]);
  });

  it('fuses independent rankings without hiding their deterministic order', () => {
    const fused = rrfRank([
      [documents[0]!, documents[1]!],
      [documents[1]!, documents[0]!],
    ]);
    expect(fused.map(({ item }) => item.id)).toEqual(['alpha', 'beta']);
    expect(fused[0]?.score).toBeGreaterThan(0);
  });
});
