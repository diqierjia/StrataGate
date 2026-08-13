<div align="center">

<img src="docs/assets/stratagate-avatar.png" alt="StrataGate 吉祥物" width="200" />

# StrataGate

### 近处保留原话，远处只看索引；证据够了才回答。

面向长期 AI Agent 的分层记忆与证据检索系统。

[![CI](https://github.com/diqierjia/StrataGate-AgentMemory/actions/workflows/ci.yml/badge.svg)](https://github.com/diqierjia/StrataGate-AgentMemory/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg)](https://www.typescriptlang.org/)

[English](README.md) · [架构说明](docs/ARCHITECTURE.md) · [完整评测](docs/EVALUATION.md)

**LoCoMo `conv-26` 最终第八轮：StrataGate 121 / 152（79.61%）· Mem0 base 96 / 152（63.16%）**

**十次 Judge 均值：80.4606% ± 0.5138 · 63.2237% ± 0.9045（+17.2369 个百分点）**

</div>

## 结果

在 LoCoMo `conv-26` 的 152 道 category 1–4 问题上，最终第八轮多数票正确 **121 / 152**，Mem0 base 为 **96 / 152**。

| 指标 | StrataGate | Mem0 base | 差值 |
| --- | ---: | ---: | ---: |
| 多数票准确率 | **79.61%** | 63.16% | **+16.45 个百分点 / +25 题** |
| 十次 Judge 平均准确率 | **80.4606%** | 63.2237% | **+17.2369 个百分点** |
| Single-hop | **89.2857%** | 75.1429% | **+14.1428 个百分点** |
| Multi-hop | **66.5625%** | 61.5625% | +5.0000 个百分点 |
| Temporal | **74.8649%** | 34.5946% | **+40.2703 个百分点** |
| Open-domain | 83.0769% | **84.6154%** | -1.5385 个百分点 |

最大的差距出现在时间类问题。Mem0 本地基础版经常把对话中的 2023 年相对日期锚定到 2026 年实验日期；StrataGate 保留来源时间戳，并能回到原始消息。原文兜底不再让重复事件卡搜索耗尽预算后，Single-hop 也明显提高。

两边都完成了 152 道题和 1,520 次 Judge，问题顺序、`gpt-5.6-sol` 回答模型与 Judge、Judge prompt、解析器和十次重复相同。两边都重新构建了记忆，但抽取管线、检索实现、embedding 和回答上下文不同。因此这只是**单会话方向性对照**，不是完整 LoCoMo 成绩，也不能单变量证明某种架构全面更强。完整协议矩阵和产物哈希见[评测说明](docs/EVALUATION.md)。

### 🎯 最终第八轮用更少检索得到更高成绩

| 运行 | 十次 Judge 均值 | 多数票 | 检索轮数 | 总 Token | 官方等价成本 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 第八轮初跑 | 70.3289% | 107 / 152 | 215 | 6.692M | $33.907 |
| **最终第八轮** | **80.4606%** | **121 / 152** | **146** | **4.088M** | **$21.406** |

第八轮初跑有 19 道题至少重复调用了三次 `search_events`，其中只有 2 题正确。最终第八轮在同一批题里答对 15 题，其中 12 题使用了原文兜底。全量逐题比较中，26 题从错变对、12 题从对变错，多数票净增 14 题；同时检索轮数减少 32.1%，证据检查调用减少 38.4%，Token 减少 38.9%。

实现层同时发生了几项变化：第一次卡片证据不足后确定性回查一次原文；结构化过滤从硬过滤改成软约束；增加可审计的中英概念词桥接；元素卡改成按事实返回。重新抽取的状态也从 92 张事件卡 / 5 张元素卡变为 97 张事件卡 / 4 张元素卡，因此在固定 memory state 消融以前，不能把全部提升归因于单项修改。

### 🧪 多轮实验真正说明了什么

| 轮次 | 留存结果 | 主要变化 | 能说明的结论 |
| --- | ---: | --- | --- |
| R1 | 67 / 152（44.08%） | 初版分层块和事件卡 | 原文可以回看，但时间覆盖很弱 |
| R2 | 77 / 152（50.66%） | 一个块多张事件卡，单独保存发生时间 | 时间类从 18.92% 升到 45.95% |
| R3 | 116 / 152（76.32%） | 抽取、读取工具、逐批证据检查一起变化 | 整套管线明显提升；有 1 题登记违规，严格分为 75.66% |
| R4 | 118 / 152（77.63%） | 有界的五字段证据门 | 基本保持成绩，同时缩小证据检查上下文 |
| R5 | 97 / 152（63.82%） | 更大的结构化检索便签 | 更复杂的内部状态造成可复现回归 |
| R6 | 未完成 | mini 模型敏感性运行 | 只有 123 题快照，不报告最终成绩 |
| R7 | 均值 71.9737%；多数票 111 / 152 | mini 抽取状态上的 Sol 检索、回答和 Judge | 工具选择更好、轮数更少，但不是端到端 Sol 抽取 |
| 第八轮初跑 | 均值 70.3289%；多数票 107 / 152 | 端到端 Sol 新状态与事件/元素混合检索 | 重复卡片搜索和未回查原文限制了成绩 |
| **最终第八轮** | **均值 80.4606%；多数票 121 / 152** | 端到端 Sol 新状态，加原文兜底和检索修复 | 当前开发切片上的最好完整结果 |

R1–R5 使用较早的 GPT-4o 评分设置，R7–R8 使用每题十次 `gpt-5.6-sol` Judge，因此这条曲线记录的是工程演进，不是严格同口径排行榜。能够反复支持的结论更窄：单独保存事件发生时间有助于时间检索；小而可执行的证据门优于过大的临时便签；换检索策略比重复同一种搜索更有价值。

### 🔎 剩余错误在哪里

最终第八轮仍有 31 道多数票错误题：

| 失败位置 | 题数 | Multi-hop | Temporal | Open-domain | Single-hop |
| --- | ---: | ---: | ---: | ---: | ---: |
| 没有检索，直接回答错误 | 15 | 5 | 3 | 2 | 5 |
| 证据门判为 `sufficient`，但答案仍错 | 14 | 6 | 6 | 0 | 2 |
| 到预算上限仍只有 `partial` 证据 | 2 | 0 | 1 | 0 | 1 |

剩余错误主要集中在：选中了相邻但错误的事件、相对日期锚定不准确、多项答案漏项。典型表现包括选错 Caroline 研究的主题、混淆两次陶艺活动、漏掉一项购买物品，以及只回答“下个月”却没有结合消息时间换算。Open-domain 的两道错误更像推断口径分歧，不是简单的事件记忆缺失。

因此下一步重点不应该是继续增加检索轮数，而是：给时间题和多跳题增加直接回答门禁；让 `sufficient` 拒绝“相关但不是同一事件”的证据；给列表题增加完整性检查；再做 gold-evidence oracle 对照，区分究竟是没找到证据，还是找到证据后仍不会回答。

## 核心优势

| 分层记忆 | 时间记忆 | 证据门 |
| --- | --- | --- |
| 同一段对话保留 L0–L5 六种详细程度；越旧显示越浅，需要时回到原文。 | 事件发生时间与提及时间分开保存，支持计划、取消、范围和纠正。 | 搜到相关内容后先判断证据是否充分；不足就继续搜索、展开事件或回查原文。 |

StrataGate 还将“搜索命中”和“回答实际采用”分开。只有真正用于回答的记忆才会被强化，避免检索结果不断强化自身。

## 工作流程

![StrataGate 工作流程：分层记忆、事件卡与证据门](docs/assets/stratagate-how-it-works.zh-CN.png)

对话先封存为分层记忆；值得长期查找的信息进入事件卡。问题到来后先搜索，证据不足就换策略或回查原文，直到通过证据门。

> **记忆有深浅，回答有门槛。**

## 一次真实的检索

在一道关于 Caroline 学校演讲时间的问题中：

```text
事件卡命中“学校演讲”
        ↓
事件相关，但缺少日期
verdict = partial
        ↓
搜索原始消息
        ↓
找到 2023-06-09 消息中的 “last week”
        ↓
verdict = sufficient
        ↓
回答
```

事件卡负责快速定位，原始消息负责最终核对，证据门负责阻止不完整证据进入回答。

## 核心设计

### 🪜 分层记忆块

默认每 12 轮完整对话封存为一个记忆块。

| 层级 | 内容 | 作用 |
| --- | --- | --- |
| L0 | 标题和标签 | 旧记忆索引 |
| L1 | 简短摘要 | 快速了解主题 |
| L2 | 关键点 | 紧凑事实 |
| L3 | 规则精简后的对话 | 去除范围明确的冗余 |
| L4 | 接近原文的可读对话 | 核对自然语言上下文 |
| L5 | 完整消息和工具记录 | 最终来源 |

新块从 L5 开始，随着会话推进逐渐显示更浅的层级。L0–L4 是同一来源的不同视图，L5 原始记录始终保留。

### 🗓️ 事件卡

决定、偏好、计划、纠正和时间事件会被整理为可搜索的事件卡。每张卡都保留来源块和来源消息，并分别记录：

- `mentionedAt`：什么时候在对话中被提到；
- `happenedStart` / `happenedEnd`：事情实际发生的时间；
- 参与者、事件类型、状态、纠正与冲突关系。

### 🚦 证据门

每批新检索结果都会生成五个短字段：

```text
verdict · evidence_refs · fit · missing · next_strategy
```

只有证据来自最新检索结果、`verdict=sufficient` 且 `next_strategy=answer` 时，系统才进入回答。`partial` 和 `wrong` 会触发下一轮搜索、事件展开或原文回查。

### 🌱 实际采用后再强化

搜索只更新检索记录。回答真正采用某张事件卡以后，才调用 `recordMemoryUse()` 更新其长期权重。

新事件可以取代旧事件，但旧来源仍然可追溯；遗忘会让事件退出搜索，同时保留来源链路。

## SQLite 持久化存储

默认构造函数仍然提供内存参考实现。如需让记忆在进程重启后恢复，安装可选的 SQLite 驱动：

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

SQLite 会保存未封块的原始消息、已封存的 L0-L5、事件来源、抽取任务、指针锚点和采用回执。所有写入使用事务和 namespace revision；旧进程继续写入时会得到冲突错误，不会静默覆盖新记忆。

原始 turn 会在摘要和抽取模型调用前提交。任一模型调用失败后，重启进程并调用 `resumePendingWork()`，只会继续未完成的 block。持久化模式下采用记忆必须传入稳定的 `receiptId`，同一个回答即使重试也不会重复强化事件。

适配器会启用 WAL 和外键检查。StrataGate 本身不加密数据库文件；保存敏感对话时，应用必须在文件系统或数据库层提供保护。

## 评测

评测文档包含：

- R1–R8 的开发序列与协议边界；
- GPT-4o-mini 与 GPT-5.6 Sol 的模型敏感性实验；
- 最终第八轮 StrataGate 与 Mem0 base 的配对结果；
- 分类成绩、逐题变化、剩余错误阶段与真实检索路径；
- Judge 设置、模型审计、重试、Token、成本和产物哈希。

详见 [`docs/EVALUATION.md`](docs/EVALUATION.md)。

## 接下来

- 固定 memory state，对原文兜底、软过滤和事实级元素检索分别做消融；
- 对剩余 31 道错误题做 gold-evidence oracle 分析；
- 在完整 LoCoMo 数据集上冻结最终端到端协议；
- 在更多会话上重复配对实验后，再提出一般性的 benchmark 结论；
- 增加一个真实框架 adapter 和数据库原生检索索引。

## 项目结构

```text
src/
  blocks.ts       对话块分层与衰减
  retrieval.ts    证据门合同
  storage.ts      持久化快照与 adapter 合同
  sqlite.ts       事务式 SQLite adapter
  store.ts        内存与持久化生命周期
  types.ts        数据结构与模型适配接口
  weights.ts      记忆采用与权重规则

tests/            核心规则测试
examples/         最小接入示例
docs/             架构与评测文档
benchmarks/       实验记录与机器可读结果
```

## 许可证

StrataGate 使用 [MIT License](LICENSE)。
