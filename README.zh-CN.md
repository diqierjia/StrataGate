<div align="center">

<img src="docs/assets/stratagate-avatar.png" alt="StrataGate 吉祥物" width="200" />

# StrataGate

### 近处保留原话，远处只看索引；证据够了才回答。

面向长期 AI Agent 的分层记忆与证据检索系统。

[![CI](https://github.com/diqierjia/StrataGate-AgentMemory/actions/workflows/ci.yml/badge.svg)](https://github.com/diqierjia/StrataGate-AgentMemory/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg)](https://www.typescriptlang.org/)

[English](README.md) · [架构说明](docs/ARCHITECTURE.md) · [完整评测](docs/EVALUATION.md)

**LoCoMo `conv-26`：StrataGate 10 次独立评审平均准确率为 80.46%，Mem0 base 为 63.22%（+17.24 个百分点）**

**多数票正确：121 / 152 vs 96 / 152（+25 题）**

</div>

## StrataGate 解决什么问题

长期运行的 Agent 不只是需要“存下更多内容”，还需要在回答时找回**正确、完整、可核对**的证据。

只保留摘要，容易丢失日期、限定条件和原话；只做相似度检索，可能找到相关内容，却不是问题真正询问的事件；把每次搜索命中都当作有效记忆，还会形成自我强化的检索反馈。

StrataGate 围绕四个核心问题设计长期记忆：

| 常见问题 | StrataGate 的处理方式 |
| --- | --- |
| 历史越来越长，无法全部放入上下文 | 将对话保存为 L0–L5 分层视图，旧记忆默认只显示较浅层级 |
| 摘要遗漏了日期、原话或限定条件 | L5 原始消息始终保留，任何派生记忆都能回到来源 |
| 搜到了相关内容，但证据不足以回答 | 使用证据门判断是否充分；不足时换策略、展开事件或回查原文 |
| 高频检索结果不断强化自身 | 只有真正被答案采用的记忆才会更新长期权重 |

StrataGate 的目标不是让 Agent 每次检索更多，而是让它知道：**当前证据是否足够，以及下一步应该去哪里找。**

## 实验结果

当前公开对比覆盖 LoCoMo `conv-26`：

- 419 条消息；
- 35 个会话；
- category 1–4 的 152 道问题；
- 每道题进行 10 次独立 Judge 评审。

| 指标 | StrataGate | Mem0 base | 差值 |
| --- | ---: | ---: | ---: |
| 10 次评审平均准确率 | **80.46%** | 63.22% | **+17.24 个百分点** |
| 多数票正确 | **121 / 152（79.61%）** | 96 / 152（63.16%） | **+25 题** |
| Temporal | **74.86%** | 34.59% | **+40.27 个百分点** |
| Single-hop | **89.29%** | 75.14% | **+14.14 个百分点** |
| Multi-hop | **66.56%** | 61.56% | +5.00 个百分点 |
| Open-domain | 83.08% | **84.62%** | -1.54 个百分点 |

最大的差距出现在时间类问题。这个结果与 StrataGate 显式保存事件发生时间、保留来源时间戳并支持原文核对的设计一致，但它不是单组件消融实验，不能把全部差距归因于某一个字段或检索步骤。

两边使用相同的问题、顺序、答案模型、Judge 模型、Judge prompt、解析器和重复次数，并且都重新构建了记忆。两边的记忆抽取、检索实现、embedding 和回答上下文不同，因此这里比较的是两个**完整系统配置**。

这只是 `conv-26` 上的一次单会话对比，不代表完整 LoCoMo 成绩。完整协议、逐题结果、Judge 波动和产物哈希见：

- [`docs/EVALUATION.md`](docs/EVALUATION.md)
- [`benchmarks/locomo-conv26-r8-final.json`](benchmarks/locomo-conv26-r8-final.json)

## 工作流程

![StrataGate 工作流程：分层记忆、事件卡与证据门](docs/assets/stratagate-how-it-works.zh-CN.png)

对话被封存为不同详细程度的分层记忆，并从中抽取带来源和时间的事件卡。问题到来后，系统先检索并判断证据是否充分；不足时继续展开事件或回查原始消息，证据充分后才回答。

## 核心设计

### 1. 分层记忆：压缩视图，不丢来源

默认每 12 轮完整对话封存为一个记忆块。尚未达到边界的消息保留在 open tail 中，不会提前压缩或抽取。

每个已封存的块包含六种详细程度：

| 层级 | 内容 | 主要用途 |
| --- | --- | --- |
| L0 | 标题和标签 | 为很久以前的记忆提供轻量索引 |
| L1 | 简短摘要 | 快速判断一段历史是否相关 |
| L2 | 关键事实 | 提供紧凑的事实列表 |
| L3 | 规则化精简对话 | 删除范围明确的冗余，不做自由语义改写 |
| L4 | 接近原文的可读对话 | 核对自然语言上下文和工具结果 |
| L5 | 完整消息和工具记录 | 最终来源 |

新块从 L5 开始。随着后续对话增加，默认展示层级逐渐变浅；需要更多细节时，可以重新展开。

L0–L4 都是同一份来源的派生视图，不会覆盖或重写 L5。事件卡同样只能引用原始块，不能反向修改来源。

这使 StrataGate 可以同时满足两个目标：

- 旧记忆保持轻量；
- 任何关键结论仍然可以回到原始消息核对。

### 2. 事件卡：同时保存内容、来源和时间

值得长期查找的决定、偏好、计划、纠正和时间事件会被整理成事件卡。

每张事件卡不仅保存摘要，还会记录：

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

其中：

- `mentionedAt` 表示这件事什么时候在对话中被提到；
- `happenedStart` / `happenedEnd` 表示事情实际发生或预计发生的时间；
- `status` 可以区分已经发生、计划中、已取消或仍在持续的事件；
- `supersedesEventIds` 和 `conflictsWithEventIds` 用于保留纠正和冲突关系。

将“提及时间”和“发生时间”分开，可以避免把消息日期直接当成事件日期，也让系统有条件正确解析“上周”“下个月”等相对时间。

事件抽取采用延迟策略：块 `N` 封存后，会等块 `N+1` 出现再进行精确抽取。抽取器可以读取相邻块作为上下文，但新增事实和引用必须来自目标块 `N`。

这样既能减少上下文被块边界切断的问题，又能阻止相邻对话中的事实被错误写入当前事件。

### 3. 证据门：相关不等于充分

普通检索系统通常在返回若干相似结果后，直接把它们交给回答模型。StrataGate 在检索和回答之间增加了一层固定协议：

```text
verdict · evidence_refs · fit · missing · next_strategy
```

每次检索后都要明确回答五个问题：

- 当前证据是 `sufficient`、`partial` 还是 `wrong`；
- 哪些结果真正支持当前判断；
- 证据与问题具体匹配在哪里；
- 还缺少什么；
- 下一步应该回答、继续搜索、展开事件，还是回查原始消息。

只有同时满足以下条件，系统才接受 `sufficient`：

1. 至少一条证据来自最新一批检索结果；
2. `next_strategy` 明确为 `answer`；
3. 判断使用固定、长度有界的结构，而不是不断增长的私有检索便签。

如果判断为 `partial` 或 `wrong`，系统可以选择：

```text
search_events
expand_event
search_raw_memory
expand_block
```

证据门不负责替应用完成整个 Agent loop。StrataGate 提供状态、约束和校验，具体模型调用、工具循环和最大检索预算仍由接入方控制。

### 4. 检索和强化分开

一次事件被搜索到，不代表它真的帮助了答案。

因此，搜索只更新可观测的检索记录，不会直接增加记忆权重。回答完成后，应用需要显式调用：

```ts
await memory.recordMemoryUse(eventIds);
```

只有真正被答案采用的事件才会更新长期权重。

这样可以避免一个常见反馈循环：

```text
某条记忆偶然排得靠前
        ↓
被频繁搜索到
        ↓
权重继续增加
        ↓
以后更容易排在前面
```

新事件可以取代旧事件，但旧事件及其来源仍然保留。遗忘可以让事件退出搜索，同时不破坏来源链路。

## 一次真实的检索

LoCoMo 中有一道题询问 Caroline 在什么时候进行了学校演讲。

事件卡已经找到了“学校演讲”，但卡片本身没有包含足够的日期信息：

```text
search_events
        ↓
命中“学校演讲”事件卡
        ↓
事件相关，但没有具体日期
verdict = partial
missing = 发生日期
        ↓
search_raw_memory
        ↓
找到 2023-06-09 的原始消息
其中写着 “last week”
        ↓
结合消息时间解析相对日期
verdict = sufficient
        ↓
回答
```

这个过程里：

- 事件卡负责快速定位；
- 来源时间戳和原始消息负责最终核对；
- 证据门阻止系统拿着不完整信息直接回答。

## 这些设计是怎么形成的

当前设计并不是一次性确定的。多轮实验里最有价值的不是轮次编号，而是暴露出的失败模式。

| 发现的问题 | 实验观察 | 最终设计选择 |
| --- | --- | --- |
| 时间信息被压在摘要里，难以准确恢复 | 在早期同口径实验中，引入每块多事件和显式发生时间后，Temporal 从 18.92% 提升到 45.95% | 将提及时间与发生时间分开，并保留原始时间表达和来源消息 |
| Agent 的检索便签越来越大 | 有界五字段证据门取得 77.63%；扩展为更大的结构化检索便签后降至 63.82% | 保持判断结构小、长度有界，并让代码校验关键约束 |
| 证据不足时反复搜索同一批事件卡 | 早期端到端版本有 19 道题至少搜索三次事件卡，只答对 2 道；当前策略在同一批题中答对 15 道，其中 12 道使用原文回查 | 搜索没有新增证据时切换信息通道，而不是继续重复同一种搜索 |

当前端到端版本相较早期版本：

| 指标 | 早期版本 | 当前版本 | 变化 |
| --- | ---: | ---: | ---: |
| 10 次评审平均准确率 | 70.33% | **80.46%** | **+10.13 个百分点** |
| 多数票正确 | 107 / 152 | **121 / 152** | **+14 题** |
| 检索轮数 | 215 | **146** | **-32.1%** |
| 证据判断调用 | 237 | **146** | **-38.4%** |
| 总 Token | 6.69M | **4.09M** | **-38.9%** |

这组结果说明，旧版本中重复事件搜索是一条明确的失败路径；改为在卡片证据不足时回到来源后，准确率和检索效率同时改善。

不过，两次端到端运行之间还修改了软过滤、中英文同义表达匹配、结果结构和重新抽取的记忆状态。因此这是一组有价值的诊断证据，不是原文回查的单变量消融实验。

R1–R8 的完整实验过程、模型与 Judge 变化、逐题迁移和协议边界见 [`docs/EVALUATION.md`](docs/EVALUATION.md)。

## 当前局限与下一步

当前版本仍有 31 道多数票错误题。按最终可观察到的失败阶段划分：

| 失败阶段 | 题数 | 暴露的问题 |
| --- | ---: | --- |
| 没有检索，直接回答错误 | 15 | 时间题、多跳题和列表题有时过早相信模型自身记忆 |
| 证据门判为 `sufficient`，最终答案仍错 | 14 | 相关但不属于目标事件的材料被误判为充分，或列表答案不完整 |
| 到检索上限仍只有 `partial` 证据 | 2 | 确实存在没有找到足够证据的情况，但并非当前主要瓶颈 |

这表明当前的主要问题已经不是“检索轮数不够”，而是系统是否应该发起检索，以及检索到的证据是否真的足以支持完整答案。

下一步将进行：

1. 固定 memory state，分别消融原文回查、软过滤和事实级检索；
2. 向回答模型直接提供 gold evidence，区分检索失败和回答推理失败；
3. 在更多会话上重复同一套配对协议；
4. 最终扩展到完整 LoCoMo 数据集。

## 当前状态

StrataGate 目前是用于验证长期 Agent 记忆设计的研究型原型。

仓库已经实现并验证了：

- 分层对话块及其衰减规则；
- 带来源、时间和冲突关系的事件卡；
- 长度有界、可由代码校验的证据门；
- 检索命中与实际采用分离的权重机制；
- 自动化测试、实验记录和机器可读评测结果。

当前公共 API、模型接入方式和评测覆盖仍在迭代，不建议将其视为已经稳定的生产 SDK。

默认实现使用内存状态。仓库也提供可选的 SQLite adapter，用于实验状态持久化、中断恢复和一致性验证；它不会改变核心检索语义，相关约束见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 代码入口

需要 Node.js 22 或更高版本。

在本地检出仓库后，可以运行：

```bash
npm install
npm run check
npm test
npm run build
```

代码与文档的主要入口：

- [`examples/basic.ts`](examples/basic.ts)：最小代码示例；
- [`src/store.ts`](src/store.ts)：核心状态、生命周期和事件检索；
- [`src/retrieval.ts`](src/retrieval.ts)：证据门规范化与约束校验；
- [`src/blocks.ts`](src/blocks.ts)：分层规则与确定性精简；
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)：完整系统边界与实现不变量；
- [`docs/EVALUATION.md`](docs/EVALUATION.md)：完整实验过程与失败分析。

`examples/basic.ts` 用于展示核心接口，而不是完整复现 benchmark 中的 Agent 工具循环。评测所使用的模型调用、工具编排和 Judge 协议见评测文档。

## 文档与复现

| 资源 | 内容 |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 数据流、分层规则、事件卡协议、证据门约束、权重和存储不变量 |
| [`docs/EVALUATION.md`](docs/EVALUATION.md) | R1–R8 实验、模型敏感性、Mem0 对比、失败分析和报告边界 |
| [`benchmarks/locomo-conv26-r8-final.json`](benchmarks/locomo-conv26-r8-final.json) | 当前结果、逐阶段统计、运行信息和源产物哈希 |
| [`examples/basic.ts`](examples/basic.ts) | 最小代码示例 |

## 项目结构

```text
src/
  blocks.ts       对话块分层、确定性精简和层级衰减
  retrieval.ts    证据门输入、规范化和约束校验
  storage.ts      持久化快照和 StorageAdapter 协议
  sqlite.ts       可选的事务式 SQLite adapter
  store.ts        内存状态、事件检索和生命周期
  types.ts        数据结构和模型适配接口
  weights.ts      采用记录、遗忘和权重规则

tests/            核心规则与存储测试
examples/         最小代码示例
docs/             架构和完整评测文档
benchmarks/       机器可读实验结果
```

## 许可证

StrataGate 使用 [MIT License](LICENSE)。
