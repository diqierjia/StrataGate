<div align="center">

<img src="docs/assets/stratagate-avatar.png" alt="StrataGate mascot" width="200" />

# StrataGate

### Recent conversations stay verbatim. Older ones become an index. Answers wait for enough evidence.

A layered memory and evidence retrieval system for long-running AI agents.

[![CI](https://github.com/diqierjia/StrataGate-AgentMemory/actions/workflows/ci.yml/badge.svg)](https://github.com/diqierjia/StrataGate-AgentMemory/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg)](https://www.typescriptlang.org/)

[中文说明](README.zh-CN.md) · [Architecture](docs/ARCHITECTURE.md) · [Full evaluation](docs/EVALUATION.md)

**LoCoMo `conv-26`, final R8: StrataGate 121 / 152 (79.61%) · Mem0 base 96 / 152 (63.16%)**

**Ten-Judge mean: 80.4606% ± 0.5138 · 63.2237% ± 0.9045 (+17.2369 percentage points)**

</div>

## Results

On the 152 category 1–4 questions from LoCoMo `conv-26`, the final round-eight run answered **121 / 152** correctly by majority vote, compared with **96 / 152** for Mem0 base.

| Metric | StrataGate | Mem0 base | Difference |
| --- | ---: | ---: | ---: |
| Majority-vote accuracy | **79.61%** | 63.16% | **+16.45 pp / +25 questions** |
| Ten-Judge mean accuracy | **80.4606%** | 63.2237% | **+17.2369 pp** |
| Single-hop | **89.2857%** | 75.1429% | **+14.1428 pp** |
| Multi-hop | **66.5625%** | 61.5625% | +5.0000 pp |
| Temporal | **74.8649%** | 34.5946% | **+40.2703 pp** |
| Open-domain | 83.0769% | **84.6154%** | -1.5385 pp |

The largest observed gap is temporal. Mem0's local base run often anchored relative 2023 dates to the 2026 experiment date, while StrataGate preserved source timestamps and could return to the original message. Single-hop accuracy also increased after raw-message fallback stopped repeated card searches from consuming the retrieval budget.

Both arms completed all 152 questions and 1,520 Judge decisions, using the same question order, `gpt-5.6-sol` answer model and Judge, Judge prompt, parser, and ten repeats. Both built fresh memory, but their extraction pipelines, retrieval implementations, embeddings, and answer contexts differ. This is therefore a **single-conversation directional comparison**, not a full LoCoMo result or a single-variable proof of architectural superiority. See the [evaluation record](docs/EVALUATION.md) for the protocol matrix and artifact hashes.

### 🎯 The final R8 gain came with less retrieval

| Run | Ten-Judge mean | Majority vote | Retrieval rounds | Total tokens | Official-equivalent cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| Initial R8 | 70.3289% | 107 / 152 | 215 | 6.692M | $33.907 |
| **Final R8** | **80.4606%** | **121 / 152** | **146** | **4.088M** | **$21.406** |

The initial R8 had 19 questions that repeated `search_events` at least three times; only 2 were correct. On those same questions, final R8 answered 15 correctly, and 12 used raw-message fallback. Across all questions, 26 changed from wrong to correct and 12 regressed, for a net gain of 14 majority-correct answers. The final run used 32.1% fewer retrieval rounds, 38.4% fewer assessment calls, and 38.9% fewer tokens.

The implementation changed in several places: the first insufficient card result now receives one deterministic raw-source fallback, structured filters became soft constraints, bilingual concept bridging was added, and element retrieval became fact-level. Fresh extraction also changed the state from 92 events / 5 elements to 97 events / 4 elements, so the gain cannot be assigned to one change without a fixed-state ablation.

### 🧪 What the development rounds establish

| Run | Reported result | Main change | What it showed |
| --- | ---: | --- | --- |
| R1 | 67 / 152 (44.08%) | Initial layered blocks and event cards | Raw history remained reachable, but temporal coverage was weak |
| R2 | 77 / 152 (50.66%) | Multiple events per block and explicit occurrence time | Temporal score rose from 18.92% to 45.95% |
| R3 | 116 / 152 (76.32%) | Extraction, tools, and per-batch assessment changed together | The combined pipeline improved sharply; one adoption violation reduces the strict score to 75.66% |
| R4 | 118 / 152 (77.63%) | Bounded five-field evidence gate | Kept the score while cutting assessment context |
| R5 | 97 / 152 (63.82%) | Larger structured retrieval scratchpad | More internal state caused a reproducible regression |
| R6 | incomplete | Mini-model sensitivity run | No final score is reported from the 123-question snapshot |
| R7 | 71.9737% mean; 111 / 152 majority | Sol retrieval, answer, and Judge on a mini-extracted state | Better tool decisions needed fewer rounds, but extraction was not end-to-end Sol |
| R8 initial | 70.3289% mean; 107 / 152 majority | Fresh end-to-end Sol state with hybrid event/element retrieval | Repeated card searches and missed raw evidence limited the result |
| **R8 final** | **80.4606% mean; 121 / 152 majority** | Raw fallback and retrieval fixes with fresh end-to-end Sol state | Best completed result on this development slice |

R1–R5 used an older GPT-4o-based scoring setup, while R7–R8 used ten `gpt-5.6-sol` Judge decisions per question. The curve documents engineering progress, not a strictly comparable leaderboard. The repeatable conclusions are narrower: explicit occurrence time helps temporal recall; a small enforceable evidence gate is better than an oversized scratchpad; and changing retrieval strategy is more useful than repeating the same search.

### 🔎 What remains wrong

Final R8 has 31 majority-wrong questions:

| Failure point | Questions | Multi-hop | Temporal | Open-domain | Single-hop |
| --- | ---: | ---: | ---: | ---: | ---: |
| Answered directly without retrieval | 15 | 5 | 3 | 2 | 5 |
| Retrieval gate said `sufficient`, but the answer was wrong | 14 | 6 | 6 | 0 | 2 |
| Evidence remained `partial` at the budget limit | 2 | 0 | 1 | 0 | 1 |

The remaining errors are concentrated in adjacent-event selection, relative-date anchoring, and incomplete multi-item answers. Examples include selecting the wrong research topic, confusing two pottery events, omitting one purchased item, and answering “next month” without resolving it against the message timestamp. Open-domain misses are mostly inference disagreements rather than missing event recall.

This changes the next optimization target: adding more retrieval rounds is unlikely to help. The higher-value work is to gate direct answers for temporal and multi-hop questions, make `sufficient` reject adjacent-but-wrong events, require completeness checks for lists, and run a gold-evidence oracle test to separate retrieval failure from answer reasoning failure.

## Core strengths

| Layered memory | Temporal memory | Evidence gate |
| --- | --- | --- |
| Each conversation block keeps six levels of detail from L0 to L5. Older blocks are shown at a shallower level, with the original available on demand. | Event time is stored separately from mention time, with support for plans, cancellations, ranges, and corrections. | Relevant results are checked for sufficiency before answering. If evidence is incomplete, the system searches again, expands an event, or returns to the raw source. |

StrataGate also separates a search hit from actual use in an answer. Only memories that genuinely support the answer are reinforced, preventing retrieval results from repeatedly reinforcing themselves.

## Workflow

![StrataGate workflow: layered memory, event cards, and the evidence gate](docs/assets/stratagate-how-it-works.en.png)

Conversations are first sealed into layered memory blocks. Information worth finding later becomes an event card. When a question arrives, StrataGate searches first; if the evidence is incomplete, it changes strategy or returns to the raw source until the evidence gate passes.

> **Memory has depth. Answers have a threshold.**

## A real retrieval path

In a question about the date of Caroline's school speech:

```text
Event card matches "school speech"
        ↓
The event is relevant, but the date is missing
verdict = partial
        ↓
Search the raw messages
        ↓
Find "last week" in the message dated 2023-06-09
        ↓
verdict = sufficient
        ↓
Answer
```

The event card provides fast location, the raw message provides final verification, and the evidence gate prevents incomplete evidence from reaching the answer.

## Core design

### 🪜 Layered memory blocks

By default, each set of 12 complete conversation turns is sealed into one memory block.

| Level | Contents | Purpose |
| --- | --- | --- |
| L0 | Title and tags | Index for older memories |
| L1 | Short summary | Quick overview of the topic |
| L2 | Key points | Compact facts |
| L3 | Rule-pruned conversation | Remove narrowly defined redundancy |
| L4 | Readable near-verbatim conversation | Verify natural-language context |
| L5 | Complete messages and tool records | Final source |

New blocks start at L5 and display progressively shallower layers as the conversation advances. L0–L4 are different views of the same source; the complete L5 record is always preserved.

### 🗓️ Event cards

Decisions, preferences, plans, corrections, and temporal events are organized into searchable event cards. Every card retains its source block and source messages, and records:

- `mentionedAt`: when the event was mentioned in the conversation;
- `happenedStart` / `happenedEnd`: when the event actually occurred;
- participants, event type, status, corrections, and conflict relationships.

### 🚦 Evidence gate

Every new batch of retrieval results produces five short fields:

```text
verdict · evidence_refs · fit · missing · next_strategy
```

The system proceeds to an answer only when the evidence comes from the latest retrieval results, `verdict=sufficient`, and `next_strategy=answer`. A `partial` or `wrong` verdict triggers another search, event expansion, or a return to the raw messages.

### 🌱 Reinforce only after actual use

Search updates only the retrieval record. The system calls `recordMemoryUse()` to update long-term weight only after an event card is genuinely used in an answer.

A new event may supersede an old one, but the old source remains traceable. Forgetting removes an event from search while preserving the source chain.

## Persistent SQLite storage

The default constructor remains an in-memory reference implementation. For restart-safe memory, install the optional SQLite driver:

```bash
npm install @diqier/stratagate better-sqlite3
```

```ts
import { StrataGate } from '@diqier/stratagate';
import { SqliteStorage } from '@diqier/stratagate/sqlite';

const memory = await StrataGate.open({
  storage: new SqliteStorage({ filename: './data/stratagate.db' }),
  namespace: 'user:alice',
  summarizer,
  extractor,
});

await memory.appendTurn({ user, assistant });
const results = await memory.searchEvents(question);

await memory.recordMemoryUse(
  results.map(({ event }) => event.id),
  { receiptId: `answer:${answerMessageId}` },
);

await memory.close();
```

SQLite stores open-tail messages, sealed L0-L5 blocks, event provenance, extraction jobs, pointer anchors, and adoption receipts. Writes use transactions and per-namespace revisions. A stale writer is rejected instead of silently overwriting newer memory.

Raw turns are committed before summarization or extraction calls. If either model call fails, `resumePendingWork()` continues only the unfinished block after restart. Persistent adoption requires a stable `receiptId`, so retrying one answer does not strengthen the same event twice.

The adapter enables WAL and foreign-key enforcement. The database file is not encrypted by StrataGate; applications that store sensitive conversations must secure it at the filesystem or database layer.

## Evaluation

The evaluation document includes:

- the R1–R8 development sequence and protocol boundaries;
- GPT-4o-mini and GPT-5.6 Sol model-sensitivity experiments;
- the final R8 paired StrataGate and Mem0 base result;
- category scores, paired question transitions, remaining-error stages, and real retrieval paths;
- Judge settings, model audits, retries, tokens, costs, and artifact hashes.

See [`docs/EVALUATION.md`](docs/EVALUATION.md).

## Next steps

- run a fixed-state ablation for raw fallback, soft filters, and fact-level element retrieval;
- run a gold-evidence oracle analysis on the 31 remaining errors;
- freeze the final end-to-end protocol for the full LoCoMo dataset;
- repeat the paired run across more conversations before making general benchmark claims;
- add a real framework adapter and database-native retrieval indexes.

## Repository layout

```text
src/
  blocks.ts       Conversation-block layering and decay
  retrieval.ts    Evidence-gate contract
  storage.ts      Persistence snapshot and adapter contracts
  sqlite.ts       Transactional SQLite adapter
  store.ts        In-memory and persistent lifecycle
  types.ts        Data structures and model-adapter interfaces
  weights.ts      Memory adoption and weighting rules

tests/            Core rule tests
examples/         Minimal integration example
docs/             Architecture and evaluation documents
benchmarks/       Experiment records and machine-readable results
```

## License

StrataGate is available under the [MIT License](LICENSE).
