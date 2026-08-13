# Evaluation record and reporting rules

This document separates completed development experiments from benchmark claims. Every public score should state the dataset scope, question categories, extraction model, answer model, Judge model, prompt, repetitions, and whether the memory state was created inside the same run.

## Final round-eight `conv-26` result

The latest completed run covers one LoCoMo conversation, `conv-26`: 419 messages, 35 sessions, and 152 category 1–4 questions. StrataGate completed all 152 answers and all 1,520 Judge decisions with no unrecovered question failure.

> [!IMPORTANT]
> This is a single-conversation directional comparison, not a full LoCoMo score or a cross-project leaderboard. StrataGate and Mem0 used the same questions, answer model, Judge, prompt, parser, and repetitions, but different memory-construction, retrieval, embedding, and answer-context pipelines. The comparison does not isolate memory architecture as one causal variable.

### Overall result

| Metric | StrataGate final R8 | Mem0 base | StrataGate - Mem0 |
| --- | ---: | ---: | ---: |
| Ten-Judge mean accuracy | **80.4606%** | 63.2237% | **+17.2369 pp** |
| Standard deviation across Judge runs | 0.5138 pp | 0.9045 pp | -0.3907 pp |
| Judge-run range | 79.6053%–81.5789% | 61.8421%–65.1316% | — |
| Majority-correct questions | **121 / 152** | 96 / 152 | **+25** |
| Majority accuracy | **79.61%** | 63.1579% | **+16.45 pp** |

The ± values describe repeated Judge variation on one fixed answer set. They are not confidence intervals across LoCoMo conversations.

### Mean accuracy by category

| Category | Questions | StrataGate final R8 | Mem0 base | StrataGate - Mem0 |
| --- | ---: | ---: | ---: | ---: |
| Multi-hop | 32 | **66.5625%** | 61.5625% | +5.0000 pp |
| Temporal | 37 | **74.8649%** | 34.5946% | **+40.2703 pp** |
| Open-domain | 13 | 83.0769% | **84.6154%** | -1.5385 pp |
| Single-hop | 70 | **89.2857%** | 75.1429% | **+14.1428 pp** |

The largest observed difference is temporal. Mem0's local base run often anchored relative dates from the 2023 conversation to the 2026 experiment date. StrataGate retained source timestamps and could fall back to the original messages. This mechanism is consistent with the gap, but the paired result is not an ablation and does not prove that timestamps or raw fallback caused the full difference.

### Paired majority outcomes

| Outcome | Questions |
| --- | ---: |
| Both correct | 80 |
| StrataGate correct, Mem0 wrong | 41 |
| StrataGate wrong, Mem0 correct | 16 |
| Both wrong | 15 |

### Protocol matrix

| Field | StrataGate final R8 | Mem0 base |
| --- | --- | --- |
| Dataset scope | `conv-26`, categories 1–4, 152 questions | Same IDs, order, text, gold answers, and categories |
| Memory construction | Fresh build from 419 timestamped messages with `gpt-5.6-sol`; 17 blocks, 97 events, 4 elements | Fresh build with `gpt-5.6-sol`; 173 final memories |
| Retrieval and assessment | BM25/RRF event and fact-level element tools, raw-message fallback, four-round budget, five-field evidence gate | Two speaker searches, top-30 each; no graph |
| Answer model | `gpt-5.6-sol`, `reasoning_effort=low` | Same |
| Judge | `gpt-5.6-sol`, ten repeats, concurrency 1 | Same model, prompt, parser, and repeats |
| Judge prompt SHA-256 | `44fb3d8f7a1f37b2430772cf90518a32172e4056b7a0dec085402763fd179b9f` | Same |
| Answer context and prompt | StrataGate-specific | Mem0-specific |
| Embedding | No vector retrieval in the evaluated event/element search | `text-embedding-3-small`, 1536 dimensions |

Mem0 used the local base SDK version 0.1.97 pinned to commit `2b58775c17eb1c1b7532242b7154af6744102280`, with Graph, Cloud, and Platform v3 disabled. It processed 419 source messages through two speaker views and completed all 428 write units.

The StrataGate run recorded 2,065 successful model responses and 14 bodyless socket failures during extraction. All 14 failures were recovered from checkpoints, no completed question was replayed, and every successful response reported `gpt-5.6-sol`. The Mem0 run retained 187 historical failed-attempt traces, all recovered; its generated summary reports `passed=false` because it treats those bodyless attempts as missing `response.model`, even though successful responses returned the expected model. Completion and clean-transport acceptance are reported separately.

The public aggregates are:

- [`benchmarks/locomo-conv26-r8-final.json`](../benchmarks/locomo-conv26-r8-final.json) for final R8, its prior-round comparisons, and remaining-error stages;
- [`benchmarks/locomo-conv26-sol-mem0-paired.json`](../benchmarks/locomo-conv26-sol-mem0-paired.json) for the earlier round-seven/Mem0 pairing retained as historical evidence;
- [`benchmarks/locomo-conv26-development.json`](../benchmarks/locomo-conv26-development.json) for R1–R5.

Raw requests and per-question traces are not copied into this public repository.

| Source artifact | SHA-256 |
| --- | --- |
| Final R8 `summary.json` | `3e29d985fcdd88a385c106838c3046808c476affb63679c2e02601b5a2006656` |
| Final R8 `checkpoint.json` | `82a2f5be362369c72aff39c7d6eaf9b5b6904ccba15a186aef1e7ff770ff79db` |
| Final R8 `source-snapshot.patch` | `5eed8bd5fd7b316ad2aaf4b142992bac31c427ea81cbb1f7ab1e81449e08e581` |
| Mem0 `summary.json` | `88f39b729546c6f343e51a11ad8f80bc1eea06ba831f33008fad779b04962927` |
| Mem0 `paired-comparison.json` | `27b604692364f24600d9513d8d2b91da9b52245a4574f581afb0afc6f00ee7fc` |
| Mem0 `protocol-audit.json` | `c1e39714eb08a775f9cbe12d0a43de6d825c142991840eab329398d1b9d744eb` |

## Development sequence

All recorded rounds used the same `conv-26` development slice, but the model and scoring protocols changed. R1–R5 used `gpt-4o-mini` extraction with a GPT-4o answerer/Judge setup. R7 and R8 used ten `gpt-5.6-sol` Judge decisions per question. R6 stopped at a 123-question snapshot and has no final score.

| Run | Main intervention | Reported result | Protocol note |
| --- | --- | ---: | --- |
| R1 | Initial layered blocks and event cards | 67 / 152 (44.08%) | Temporal accuracy 18.92% |
| R2 | Multiple event cards per block and explicit occurrence time | 77 / 152 (50.66%) | Temporal accuracy rose to 45.95% |
| R3 | Extraction, read tools, and per-batch assessment changed together | 116 / 152 (76.32%) | One adoption-rule violation; strict result 115 / 152 (75.66%) |
| R4 | Bounded five-field assessment context | 118 / 152 (77.63%) | Zero recorded adoption violations and about 10.35% fewer QA tokens than R3 |
| R5 | Larger structured retrieval scratchpad | 97 / 152 (63.82%) | Reproducible regression led to restoring the smaller gate |
| R6 | Mini-model sensitivity run | incomplete | 123-question snapshot only; no final score |
| R7 | Sol retrieval, assessment, answer, and Judge | 71.9737% mean; 111 / 152 majority | Reused a state extracted with `gpt-4o-mini`; not end-to-end Sol |
| R8 initial | Fresh end-to-end Sol extraction and hybrid event/element retrieval | 70.3289% mean; 107 / 152 majority | Repeated card searches frequently exhausted the budget |
| **R8 final** | Fresh end-to-end Sol state with raw fallback and retrieval fixes | **80.4606% mean; 121 / 152 majority** | Best completed result on this slice |

The sequence supports several engineering conclusions, not a single cumulative causal curve:

1. Explicit occurrence time improved temporal questions on the fixed early-round protocol.
2. A small, enforceable evidence gate performed better than a larger structured scratchpad.
3. Model and Judge changes materially affect scores; at least one fixed answer moved from 10 / 10 correct under the mini Judge to 0 / 10 under the Sol Judge.
4. Retrieval strategy matters more than raw search count. Repeating the same card search can be worse than changing channel and checking the original source.
5. Element-card value remains unresolved. Final R8 used `search_elements` on only four questions; all four were correct, but this usage-conditioned subset is too small and selected to support a causal claim.

## Initial R8 versus final R8

| Metric | Initial R8 | Final R8 | Change |
| --- | ---: | ---: | ---: |
| Ten-Judge mean | 70.3289% | **80.4606%** | **+10.1317 pp** |
| Majority correct | 107 / 152 | **121 / 152** | **+14** |
| Retrieval rounds | 215 | **146** | -69 (-32.1%) |
| Assessment calls | 237 | **146** | -91 (-38.4%) |
| Total tokens | 6,692,417 | **4,088,324** | -2,604,093 (-38.9%) |
| Official-equivalent cost | $33.907499 | **$21.406145** | -$12.501354 (-36.9%) |

Question-level majority transitions were: 95 both correct, 26 final-R8-only correct, 12 initial-R8-only correct, and 19 both wrong.

The initial run had 19 questions with at least three `search_events` calls; only 2 were majority-correct. Final R8 answered 15 of those same questions correctly, with 12 using raw-message fallback. A representative temporal question asked when Caroline gave a school speech: the initial run repeatedly searched event cards and abstained, while final R8 fell back to the source message dated 2023-06-09, resolved “last week,” and received 10 / 10 correct Judge votes.

This is strong diagnostic evidence that the old repeated-search path was defective. It is not a clean ablation: retrieval policy, filters, element result shape, and freshly extracted memory contents all changed.

## Remaining-error analysis

Final R8 has 31 majority-wrong questions. Their observable failure stage is:

| Failure stage | Questions | Multi-hop | Temporal | Open-domain | Single-hop |
| --- | ---: | ---: | ---: | ---: | ---: |
| Direct answer without retrieval | 15 | 5 | 3 | 2 | 5 |
| Retrieval marked `sufficient`, final answer wrong | 14 | 6 | 6 | 0 | 2 |
| Retrieval remained `partial` at the limit | 2 | 0 | 1 | 0 | 1 |
| **Total** | **31** | **11** | **10** | **2** | **8** |

The two largest problems are therefore not a lack of retrieval rounds:

- **Direct-answer risk:** 15 wrong answers bypassed retrieval entirely. These include missed list facts, wrong event details, and unanchored relative dates.
- **False sufficiency:** 14 answers passed the evidence gate but were still wrong. The selected material was often related but belonged to an adjacent event, or it supported only part of a requested list.

Recurring patterns include:

- choosing the wrong research topic or the wrong pottery event;
- resolving a relative date against the wrong message or returning “next month” without an absolute anchor;
- omitting one item from books, instruments, purchases, or attended events;
- using a generally plausible reason instead of the event-specific reason requested;
- open-domain Judge disagreements where the memory evidence supports more than one cautious inference.

The next diagnostic should inject the gold-evidence raw block while keeping the answer and Judge protocol fixed. That oracle split will distinguish retrieval/selection failure from answer reasoning and temporal-calculation failure. Before increasing the retrieval budget, the implementation should also gate direct temporal/multi-hop answers, tighten `sufficient` against adjacent events, and add completeness checks for list questions.

## Reporting checklist

Before treating two scores as comparable, freeze and report:

- dataset version and conversation/question scope;
- included categories;
- extraction code and model;
- retrieval code, tools, budgets, and prompts;
- answer model, temperature, and reasoning configuration;
- Judge prompt, model, temperature, parser, and repetitions;
- provider and returned-model audit;
- memory-state provenance;
- retries, missing responses, and checkpoint completion;
- exact numerator and denominator, not only a rounded percentage.

## What the current evidence supports

The current evidence supports these narrow claims:

- on `conv-26` and the tested configurations, final R8 scored 121 / 152 by majority vote and Mem0 base scored 96 / 152;
- the largest observed paired category difference was temporal, while Mem0 remained slightly higher on open-domain questions;
- the final R8 retrieval policy avoided a measured repeated-event-search failure mode while using fewer rounds, tokens, and cost;
- explicit occurrence time, an enforceable evidence gate, and raw-source access are useful components on this development slice;
- remaining errors are split mainly between direct answers that skipped retrieval and retrieved evidence incorrectly marked sufficient;
- completed per-question checkpoints and request traces are necessary to distinguish model behavior from transport failure.

It does not yet support these broader claims:

- state of the art on LoCoMo;
- generalization across the full LoCoMo dataset;
- architectural superiority under a shared end-to-end retrieval and context protocol;
- a single-component causal explanation for the final R8 gain;
- a causal benefit from element cards without disabled/forced/fixed-state ablations.

The next credible milestone is a fixed-state component ablation, followed by the same frozen end-to-end protocol across more conversations and then the full dataset.
