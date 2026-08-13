<div align="center">

<img src="docs/assets/stratagate-avatar.png" alt="StrataGate mascot" width="200" />

# StrataGate

### Keep recent conversations verbatim. Show older history as an index. Answer only when the evidence is sufficient.

A layered memory and evidence retrieval system for long-running AI agents.

[![CI](https://github.com/diqierjia/StrataGate-AgentMemory/actions/workflows/ci.yml/badge.svg)](https://github.com/diqierjia/StrataGate-AgentMemory/actions/workflows/ci.yml)

[中文说明](README.zh-CN.md) · [Architecture](docs/ARCHITECTURE.md) · [Full evaluation](docs/EVALUATION.md)

**LoCoMo `conv-26`: StrataGate averaged 80.46% accuracy across 10 independent Judge runs, versus 63.22% for Mem0 base (+17.24 percentage points)**

**Majority-correct: 121 / 152 vs 96 / 152 (+25 questions)**

</div>

## What problem does StrataGate solve?

A long-running agent needs more than a way to “store more.” When it answers, it must retrieve evidence that is **correct, complete, and verifiable**.

Keeping only summaries can lose dates, qualifications, and original wording. Similarity search can return related material that belongs to a different event. Treating every search hit as useful memory can also create a self-reinforcing retrieval loop.

StrataGate designs long-term memory around four core problems:

| Common problem | How StrataGate handles it |
| --- | --- |
| History keeps growing and no longer fits in context | Store conversations as L0–L5 layered views; older memories default to shallower levels |
| A summary omits a date, exact wording, or qualification | Preserve the L5 source messages permanently, so every derived memory can return to its source |
| Search finds related material, but not enough evidence to answer | Use an evidence gate to judge sufficiency; if evidence is incomplete, change strategy, expand an event, or inspect the source |
| Frequently retrieved results keep reinforcing themselves | Update long-term weight only for memories that the final answer actually uses |

StrataGate is not designed to make an agent retrieve more on every turn. It is designed to make the agent know **whether the current evidence is sufficient and where to look next**.

## Experimental results

The current public comparison covers LoCoMo `conv-26`:

- 419 messages;
- 35 sessions;
- 152 category 1–4 questions;
- 10 independent Judge evaluations per question.

| Metric | StrataGate | Mem0 base | Difference |
| --- | ---: | ---: | ---: |
| Mean accuracy across 10 Judge runs | **80.46%** | 63.22% | **+17.24 percentage points** |
| Majority-correct | **121 / 152 (79.61%)** | 96 / 152 (63.16%) | **+25 questions** |
| Temporal | **74.86%** | 34.59% | **+40.27 percentage points** |
| Single-hop | **89.29%** | 75.14% | **+14.14 percentage points** |
| Multi-hop | **66.56%** | 61.56% | +5.00 percentage points |
| Open-domain | 83.08% | **84.62%** | -1.54 percentage points |

The largest difference is in temporal questions. This is consistent with StrataGate's design—explicit event occurrence times, preserved source timestamps, and raw-source verification—but it is not a single-component ablation, so the full gap cannot be attributed to one field or retrieval step.

Both systems used the same questions, order, answer model, Judge model, Judge prompt, parser, and repeat count, and both rebuilt memory from scratch. Their memory extraction, retrieval implementation, embedding, and answer context differed, so this comparison is between two **complete system configurations**.

This is a single-conversation comparison on `conv-26`, not a full LoCoMo score. For the complete protocol, per-question results, Judge variation, and artifact hashes, see:

- [`docs/EVALUATION.md`](docs/EVALUATION.md)
- [`benchmarks/locomo-conv26-r8-final.json`](benchmarks/locomo-conv26-r8-final.json)

## Workflow

![StrataGate workflow: layered memory, event cards, and the evidence gate](docs/assets/stratagate-how-it-works.en.png)

Conversations are sealed into layered memories at different levels of detail, and event cards with provenance and time are extracted from them. When a question arrives, the system retrieves evidence and assesses whether it is sufficient. If not, it continues by expanding events or returning to the original messages; it answers only after the evidence is sufficient.

## Core design

### 1. Layered memory: compressed views without losing the source

By default, every 12 complete conversation turns are sealed into one memory block. Messages that have not yet reached the boundary remain in the open tail and are not compressed or extracted early.

Each sealed block contains six levels of detail:

| Level | Contents | Primary use |
| --- | --- | --- |
| L0 | Title and tags | A lightweight index for distant memories |
| L1 | Short summary | Quickly judge whether a piece of history is relevant |
| L2 | Key facts | A compact factual list |
| L3 | Deterministically pruned conversation | Remove narrowly defined redundancy without free-form semantic rewriting |
| L4 | Readable near-verbatim conversation | Verify natural-language context and tool results |
| L5 | Complete messages and tool records | Final source |

New blocks start at L5. As more conversation follows, the default displayed level becomes progressively shallower; deeper detail can be expanded again when needed.

L0–L4 are derived views of the same source. They never overwrite or rewrite L5. Event cards likewise reference their source blocks and cannot modify them.

This lets StrataGate satisfy two goals at once:

- old memories remain lightweight;
- every important conclusion can still be verified against the original messages.

### 2. Event cards: store content, source, and time together

Decisions, preferences, plans, corrections, and temporal events that are worth finding later are organized into event cards.

Each event card stores more than a summary:

```ts
{
  sourceBlockId,
  sourceMessageIds,

  mentionedAt,
  happenedStart,
  happenedEnd,

  status,
  participants,
  eventType,

  supersedesEventIds,
  conflictsWithEventIds
}
```

In this structure:

- `mentionedAt` is when the event was mentioned in the conversation;
- `happenedStart` / `happenedEnd` describe when it actually happened or is expected to happen;
- `status` distinguishes completed, planned, cancelled, and ongoing events;
- `supersedesEventIds` and `conflictsWithEventIds` preserve corrections and conflicts.

Separating mention time from occurrence time prevents the system from treating a message timestamp as the event timestamp. It also gives the system enough information to resolve relative expressions such as “last week” and “next month.”

Event extraction is delayed: after block `N` is sealed, precise extraction waits until block `N+1` exists. The extractor can read neighboring blocks as context, but every new fact and source reference must come from target block `N`.

This reduces the chance that context is cut at a block boundary while preventing facts from neighboring conversations from being written into the wrong event.

### 3. Evidence gate: relevant does not mean sufficient

A conventional retrieval system often hands several similar results directly to the answer model. StrataGate inserts a fixed protocol between retrieval and answering:

```text
verdict · evidence_refs · fit · missing · next_strategy
```

After every retrieval, the system must answer five questions explicitly:

- is the current evidence `sufficient`, `partial`, or `wrong`;
- which results actually support that judgment;
- how the evidence matches the question;
- what is still missing;
- should the next step answer, continue searching, expand an event, or inspect the original messages.

The system accepts `sufficient` only when all of the following are true:

1. at least one evidence item comes from the latest retrieval batch;
2. `next_strategy` is explicitly `answer`;
3. the judgment uses a fixed, bounded structure instead of an ever-growing private retrieval scratchpad.

If the judgment is `partial` or `wrong`, the system can choose:

```text
search_events
expand_event
search_raw_memory
expand_block
```

The evidence gate does not run the entire agent loop for the application. StrataGate supplies state, constraints, and validation; the integrating application still controls model calls, tool iteration, and the maximum retrieval budget.

### 4. Separate retrieval from reinforcement

An event being retrieved does not mean that it helped the answer.

Search therefore updates only observable retrieval records; it does not directly increase memory weight. After the answer is complete, the application explicitly calls:

```ts
await memory.recordMemoryUse(eventIds);
```

Only events that the answer actually used update their long-term weight.

This avoids a common feedback loop:

```text
A memory happens to rank highly
        ↓
It is retrieved frequently
        ↓
Its weight keeps increasing
        ↓
It becomes even more likely to rank highly
```

A new event can supersede an old one, while the old event and its source remain available. Forgetting can remove an event from search without breaking the provenance chain.

## A real retrieval path

One LoCoMo question asks when Caroline gave a speech at a school.

The event card found the “school speech,” but the card itself did not contain enough date information:

```text
search_events
        ↓
Match the “school speech” event card
        ↓
The event is relevant, but has no exact date
verdict = partial
missing = occurrence date
        ↓
search_raw_memory
        ↓
Find the source message dated 2023-06-09
It says “last week”
        ↓
Resolve the relative date against the message timestamp
verdict = sufficient
        ↓
Answer
```

In this path:

- the event card provides fast location;
- the source timestamp and original message provide final verification;
- the evidence gate prevents the system from answering from incomplete information.

## How these designs emerged

The current design was not decided in one pass. The most useful result of multiple experiments was not the round number, but the failure mode each round exposed.

| Problem discovered | Experimental observation | Final design choice |
| --- | --- | --- |
| Temporal information was compressed into summaries and hard to recover accurately | In the early matched-protocol experiments, adding multiple events per block and explicit occurrence times raised Temporal from 18.92% to 45.95% | Separate mention time from occurrence time, and preserve the original temporal expression and source message |
| The agent's retrieval scratchpad kept growing | The bounded five-field evidence gate scored 77.63%; expanding it into a larger structured scratchpad reduced the score to 63.82% | Keep the judgment small and bounded, and let code validate its critical constraints |
| When evidence was insufficient, the agent repeatedly searched the same event cards | An early end-to-end version had 19 questions with at least three event searches and answered only 2 correctly; the current strategy answered 15 of the same questions, including 12 that inspected the source | Change information channels when search adds no new evidence instead of repeating the same search |

Compared with the earlier end-to-end version, the current version produced:

| Metric | Earlier version | Current version | Change |
| --- | ---: | ---: | ---: |
| Mean accuracy across 10 Judge runs | 70.33% | **80.46%** | **+10.13 percentage points** |
| Majority-correct | 107 / 152 | **121 / 152** | **+14 questions** |
| Retrieval rounds | 215 | **146** | **-32.1%** |
| Evidence-assessment calls | 237 | **146** | **-38.4%** |
| Total tokens | 6.69M | **4.09M** | **-38.9%** |

These results show that repeated event search was a concrete failure path in the old version. Returning to the source when card evidence was incomplete improved both accuracy and retrieval efficiency.

However, the two end-to-end runs also differed in soft filters, Chinese-English synonym matching, result structure, and the freshly extracted memory state. This is useful diagnostic evidence, not a single-variable ablation of raw-source fallback.

For the complete R1–R8 experiment history, model and Judge changes, per-question transitions, and protocol boundaries, see [`docs/EVALUATION.md`](docs/EVALUATION.md).

## Current limitations and next steps

The current version still has 31 majority-wrong questions. Grouped by the final observable failure stage:

| Failure stage | Questions | Problem exposed |
| --- | ---: | --- |
| Answered directly without retrieval | 15 | Temporal, multi-hop, and list questions sometimes trust the model's own memory too early |
| Evidence gate returned `sufficient`, but the final answer was wrong | 14 | Related material from a different event was accepted as sufficient, or a list answer was incomplete |
| Evidence remained `partial` at the retrieval limit | 2 | Some questions genuinely did not retrieve enough evidence, but this is not the main bottleneck |

This indicates that the main problem is no longer “not enough retrieval rounds.” It is whether retrieval should start at all and whether the retrieved evidence truly supports a complete answer.

Next steps:

1. freeze the memory state and separately ablate raw-source fallback, soft filters, and fact-level retrieval;
2. provide gold evidence directly to the answer model to distinguish retrieval failure from answer-reasoning failure;
3. repeat the same paired protocol across more conversations;
4. finally expand to the complete LoCoMo dataset.

## Current status

StrataGate is currently a research prototype for validating long-term agent memory designs.

The repository has implemented and validated:

- layered conversation blocks and their decay rules;
- event cards with provenance, time, and conflict relationships;
- a bounded evidence gate whose constraints can be checked by code;
- a weighting mechanism that separates retrieval hits from actual answer use;
- automated tests, experiment records, and machine-readable evaluation results.

The public API, model integration, and evaluation coverage are still evolving. StrataGate should not yet be treated as a stable production SDK.

The default implementation uses in-memory state. The repository also provides an optional SQLite adapter for experimental-state persistence, interruption recovery, and consistency validation. It does not change the core retrieval semantics; see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the constraints.

## Code entry points

Node.js 22 or later is required.

After checking out the repository locally, run:

```bash
npm install
npm run check
npm test
npm run build
```

The main code and documentation entry points are:

- [`examples/basic.ts`](examples/basic.ts): minimal code example;
- [`src/store.ts`](src/store.ts): core state, lifecycle, and event retrieval;
- [`src/retrieval.ts`](src/retrieval.ts): evidence-gate normalization and constraint validation;
- [`src/blocks.ts`](src/blocks.ts): layering rules and deterministic pruning;
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): complete system boundaries and implementation invariants;
- [`docs/EVALUATION.md`](docs/EVALUATION.md): complete experiment history and failure analysis.

`examples/basic.ts` demonstrates the core API; it does not fully reproduce the agent tool loop used in the benchmark. See the evaluation document for the model calls, tool orchestration, and Judge protocol used in the evaluation.

## Documentation and reproduction

| Resource | Contents |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Data flow, layering rules, event-card protocol, evidence-gate constraints, weighting, and storage invariants |
| [`docs/EVALUATION.md`](docs/EVALUATION.md) | R1–R8 experiments, model sensitivity, Mem0 comparison, failure analysis, and reporting boundaries |
| [`benchmarks/locomo-conv26-r8-final.json`](benchmarks/locomo-conv26-r8-final.json) | Current result, per-stage statistics, run information, and source artifact hashes |
| [`examples/basic.ts`](examples/basic.ts) | Minimal code example |

## Repository layout

```text
src/
  blocks.ts       Conversation layering, deterministic pruning, and level decay
  retrieval.ts    Evidence-gate input, normalization, and constraint validation
  storage.ts      Persistent snapshots and the StorageAdapter protocol
  sqlite.ts       Optional transactional SQLite adapter
  store.ts        In-memory state, event retrieval, and lifecycle
  types.ts        Data structures and model-adapter interfaces
  weights.ts      Adoption records, forgetting, and weighting rules

tests/            Core-rule and storage tests
examples/         Minimal code example
docs/             Architecture and complete evaluation
benchmarks/       Machine-readable experiment results
```

## License

StrataGate is available under the [MIT License](LICENSE).
