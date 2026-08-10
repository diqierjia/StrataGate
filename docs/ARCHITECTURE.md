# StrataGate architecture

StrataGate separates source preservation, derived memory, retrieval control, and reinforcement. Combining these responsibilities makes it easy for a summary mistake or a ranking feedback loop to become an apparently certain answer.

## System boundaries

```mermaid
flowchart TB
    subgraph Source["Source layer"]
      T["Open conversation tail"]
      B["Permanent 12-turn blocks"]
      L["L0-L5 views"]
      T --> B --> L
    end

    subgraph Derived["Derived memory"]
      E["Temporal event cards"]
      W["Adoption-based weight state"]
      E --> W
    end

    subgraph Retrieval["Retrieval control"]
      S["Search"]
      A["Five-field assessment"]
      X["Expand or change strategy"]
      S --> A
      A -->|"partial / wrong"| X
      X --> A
    end

    B --> E
    L --> Retrieval
    E --> Retrieval
    A -->|"sufficient"| U["Answer and usage receipt"]
    U --> W
```

The data flow from blocks to event cards is one-way. Derived cards never rewrite their source block.

## Conversation blocks

A completed user/assistant pair is one turn. The default block boundary is 12 completed turns. Messages that have not reached the boundary remain in the open tail and are not condensed or extracted.

When the boundary is reached:

1. L5 stores the raw messages and tool traces.
2. L4 converts tool payloads into readable summaries while preserving natural-language turns.
3. L3 applies a deterministic, bounded condensation policy.
4. A caller-provided summarizer produces L0-L2 and a conservative `shouldExtract` decision.
5. The block pointer starts at L5 and decays toward L0 as later turns accumulate.

The block weight is:

```text
w(t) = exp(-0.05 * t)

t = current turn - pointer anchor turn
```

The weight selects how many levels to drop from the pointer anchor. Expanding a block to L3 anchors the pointer at L3; it does not silently jump to L5.

## Deterministic L3 policy

L3 may remove only:

1. standalone greetings or acknowledgements;
2. standalone pure confirmations;
3. raw tool-call argument payloads, while retaining tool name and a bounded result summary;
4. exact repeated long pasted text or code after the first occurrence.

Short repeated natural-language messages are retained. L3 never performs semantic paraphrasing.

## Delayed event extraction

If block `N` is marked as a candidate, precise extraction waits until block `N+1` is sealed. The extractor receives:

- previous block `N-1` for context, if it exists;
- target block `N`, including its L5 source;
- next block `N+1` for context;
- a compact timeline of existing event IDs, titles, and temporal fields.

The target is the only legal source of new facts and quotations. Source message IDs are checked against the target block. The reference implementation falls back to all target messages when an extractor returns no valid source ID; stricter adapters may reject the card instead.

## Event-card contract

An event card stores content, provenance, time, governance, and weight separately.

```ts
interface EventCard {
  id: string;
  title: string;
  summary: string;
  narrative: string;
  tags: string[];
  quotes: string[];

  sourceBlockId: string;
  sourceMessageIds: string[];

  temporal: {
    mentionedAt?: string;
    happenedStart?: string;
    happenedEnd?: string;
    originalText?: string;
    precision?: 'instant' | 'day' | 'month' | 'year' | 'range' | 'unknown';
    basis?: 'explicit' | 'relative' | 'inferred' | 'unknown';
    status?: 'occurred' | 'planned' | 'cancelled' | 'ongoing' | 'unknown';
    participants?: string[];
    eventType?: string;
    supersedesEventIds?: string[];
    conflictsWithEventIds?: string[];
  };

  status: 'active' | 'superseded' | 'forgotten' | 'archived';
  weight: MemoryWeight;
}
```

`mentionedAt` answers when the conversation referred to the event. `happenedStart` and `happenedEnd` answer when the event itself occurred. Keeping these axes separate avoids treating the message timestamp as the event date.

## Event weight and adoption

Event decay uses:

```text
w(t, n) = max(floor, exp(-lambda(n) * t))
lambda(n) = 0.15 / (1 + 1.5 * ln(n))
```

`n` is the number of recorded adoptions, not retrieval hits. Search updates `lastRetrievedAt` for observability, while `recordMemoryUse()` increments the adoption count and moves the decay anchor.

Criticality floors in the reference implementation are:

| Criticality | Floor |
| --- | ---: |
| routine | 0.0 |
| preference | 0.3 |
| identity | 0.9 |
| safety | 1.0 |

A pinned event has effective weight 1. A superseded event is capped at 0.1. Forgotten and archived events have effective weight 0.

## Retrieval assessment contract

The assessment contract is deliberately small:

```ts
interface RetrievalAssessment {
  verdict: 'sufficient' | 'partial' | 'wrong';
  evidenceRefs: string[];
  fit: string;
  missing: string;
  nextStrategy:
    | 'answer'
    | 'search_events'
    | 'expand_event'
    | 'search_raw_memory'
    | 'expand_block';
}
```

Normalization enforces three conditions before `sufficient` is accepted:

1. at least one evidence ID belongs to the latest retrieval batch;
2. the chosen next strategy is `answer`;
3. the assessment uses the bounded schema rather than carrying a growing private scratchpad.

If the retrieval budget ends without sufficient evidence, the caller should pass the full retrieval transcript to the answer model and require explicit uncertainty. The core exposes the gate; applications own the tool loop and final model call.

## Storage adapters

The current repository contains an in-memory reference store. A production adapter should preserve these invariants:

- blocks and L5 messages are append-only;
- card provenance references an existing source block and message set;
- search hits do not increment adoption state;
- supersession retains the old event;
- forget is reversible unless an application explicitly implements irreversible deletion;
- usage receipts are idempotent for one answer turn.

SQLite and Postgres adapters are planned, but are not claimed as complete in the initial open-source release.
