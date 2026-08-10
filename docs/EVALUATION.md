# Evaluation record and reporting rules

This document separates completed development experiments from benchmark claims. Every public score should state the dataset scope, question categories, extraction model, answer model, judge model, prompt, repetitions, and whether the memory state was created inside the same run.

## Development sequence

The first five completed runs used one LoCoMo conversation, `conv-26`:

- 419 messages;
- 35 sessions;
- 152 category 1-4 questions;
- `gpt-4o-mini` extraction;
- `gpt-4o` answerer and judge.

The fixed slice made regressions cheap to inspect, but it is not a full LoCoMo evaluation.

| Run | Main intervention | Correct | Accuracy | Protocol note |
| --- | --- | ---: | ---: | --- |
| 1 | Initial block/event architecture | 67 / 152 | 44.08% | Temporal questions were especially weak |
| 2 | Multiple event cards per block and explicit event occurrence time | 77 / 152 | 50.66% | Temporal-category accuracy rose from 18.92% to 45.95% |
| 3 | Extraction, read tools, and per-batch assessment changed together | 116 / 152 | 76.32% | One adoption-rule violation; strict score 115 / 152 (75.66%) |
| 4 | Bounded assessment context and fixed budget-end adoption | 118 / 152 | 77.63% | Zero recorded adoption violations; about 10.35% fewer QA tokens than run 3 |
| 5 | Larger structured retrieval scratchpad | 97 / 152 | 63.82% | Regression led to restoring run 4's five-field contract |

These runs show an engineering process. They do not isolate every causal variable. In particular, run 3 changed several components at once, so its gain cannot be attributed to a single tool or prompt.

## Protocol controls and sensitivity checks

Later runs answered different questions about the evaluation protocol and are not added to the development curve.

### Frozen mini-model protocol

A completed 152-question run fixed extraction, answering, judging, prompt, temperature, category scope, and ten independent judge decisions per question to the chosen mini-model protocol.

- 152 / 152 questions completed;
- ten judge decisions per question;
- mean score: 48.9474%;
- majority score: 74 / 152 (48.68%).

This result is useful for protocol comparability. It must not be plotted as a direct regression from run 4 because the answerer and judge changed.

### Sol retrieval/answer/judge sensitivity run

Another completed run used `gpt-5.6-sol` for retrieval, assessment, answering, and judging:

- 152 / 152 questions completed;
- 1,520 judge decisions;
- mean score: 71.9737%;
- majority score: 111 / 152 (73.03%).

This run reused a previously extracted memory state. It was not an end-to-end Sol extraction result. Retrieval, assessment, answering, and judging changed together, so the score is directional and not evidence that any one memory component caused the difference.

### Judge sensitivity

At least one fixed answer received opposite judgments under two judge models: 10 / 10 correct with the mini judge and 0 / 10 with the Sol judge. This is why StrataGate does not treat judge changes as memory-quality changes.

## Excluded result

An official Mem0-base control was prepared but stopped during embedding preflight after repeated HTTP 503 responses. It completed zero writes and zero questions. There is no Mem0 baseline score from that run, so it is intentionally absent from result tables.

## Reporting checklist

Before treating two scores as comparable, freeze and report:

- dataset version and conversation/question scope;
- included categories;
- extraction code and model;
- retrieval code, tools, budgets, and prompts;
- answer model, temperature, and reasoning configuration;
- judge prompt, model, temperature, and repetitions;
- provider and returned-model audit;
- memory-state provenance;
- retries, missing responses, and checkpoint completion;
- exact numerator and denominator, not only a rounded percentage.

## What the current evidence supports

The current evidence supports these narrow claims:

- separating event occurrence time from mention time improved temporal questions on the fixed development conversation;
- evidence checking after retrieval batches was part of the best-performing development configuration;
- the larger retrieval scratchpad caused a reproducible regression on the same slice;
- judge choice can materially change the score of identical answers;
- completed per-question checkpoints and request traces are necessary to distinguish model behavior from transport failure.

It does not yet support these broader claims:

- state of the art on LoCoMo;
- generalization across the full LoCoMo dataset;
- superiority to another open-source memory system under a shared end-to-end protocol;
- a single-component causal explanation for the run 3 or Sol gains.

The next credible milestone is a full-dataset, end-to-end run with one frozen protocol and a completed baseline under the same question, answer, and judge configuration.
