# StrataGate Full for WorkBuddy Desktop

StrataGate Full 是 WorkBuddy Desktop 的本地优先跨会话记忆插件。它把 Host Adapter 和 MCP Server 放在同一个插件中：回答前自动检索并通过 `additionalContext` 注入历史证据，回答后从 transcript 增量保存完整 L5，再由常驻 MCP 进程调用 WorkBuddy 自带的 `lite` 模型生成 L0–L4、Event 和 Element。用户不需要另外填写 API Key。

## 工作流

```text
用户提交问题
    ↓ UserPromptSubmit Hook
本地检索 Event / Element / L5
    ↓ additionalContext（带 batchId 和 evidence refs）
WorkBuddy 回答并通过 MCP 评估、展开证据
    ↓ Stop Hook
增量读取 transcript，幂等保存 L5
    ↓ 后台 worker
封存 L0–L4 → 延迟提取 Event → 投影 Element
```

Hook 与 MCP 共用 `${CODEBUDDY_PLUGIN_DATA}/memory.db`。默认按规范化后的项目路径隔离 namespace，不会把不同项目的记忆混在一起。

## 功能

- `UserPromptSubmit` 自动检索已保存记忆，不依赖 Agent 主动想起要搜索；
- `Stop` 只读取 transcript 新增尾部，并使用稳定 receipt 防止重复写入；
- 先原子保存 L5，再由后台 worker 生成派生层，避免 Stop 等待模型；
- 检索批次和 Evidence Gate 使用显式、持久化的 `batchId`；
- 只有通过 `memory_assess` 且真正调用 `memory_record_use` 的证据才会强化；
- 累计 3 次有证据支持的实际采用后，只显示一次可关闭的 GitHub Star 邀请；
- StrataGate 自己的 MCP 调用和注入上下文不会被重新写成新记忆；
- 常见 token、Bearer 凭证和 key/value 凭证在召回内容进入模型上下文前会脱敏。

## 本地开发

在 StrataGate 仓库根目录运行：

```bash
npm install
npm run build:workbuddy
codebuddy plugin validate ./integrations/workbuddy
codebuddy --plugin-dir ./integrations/workbuddy
```

修改插件后，在 WorkBuddy 中运行 `/reload-plugins`。

## 通过市场安装

发布 `stratagate-workbuddy` npm 包后：

```text
/plugin marketplace add diqierjia/StrataGate-AgentMemory
/plugin install stratagate-memory@stratagate-plugins
/reload-plugins
```

市场使用 npm source 安装插件，因此 `better-sqlite3` 等运行时依赖会随插件一起安装。

## 记忆模型

默认通过 WorkBuddy Headless 模式调用当前账号可用的 `lite` 场景模型，并使用 JSON Schema 约束结构化输出。子进程会禁用工具、外部 MCP、会话持久化和 StrataGate Host Adapter，避免读取项目、产生额外 transcript 或递归触发插件。

因此正常安装没有模型配置步骤，也不需要新的 API Key；后台处理会使用用户现有的 WorkBuddy 登录状态和相应模型额度。

如果需要禁用 WorkBuddy 模型或为企业部署提供备用 OpenAI-compatible 端点，可以在启动 WorkBuddy 前设置：

```text
STRATAGATE_DISABLE_WORKBUDDY_MODEL=1
STRATAGATE_MODEL_BASE_URL
STRATAGATE_MODEL
STRATAGATE_MODEL_API_KEY
```

默认 `memory_status` 显示 `mode: full` 和 `provider: workbuddy`。只有显式禁用 WorkBuddy 模型且没有配置备用端点时，才进入 `layered-raw` 模式：L5 仍会自动保存，L0–L4 仍会后台封存，并保留未来补做 Event/Element 的提取资格。

## MCP 工具

```text
memory_search_events   memory_expand_event
memory_search_elements memory_expand_element
memory_search_raw      memory_get_blocks
memory_expand_block    memory_assess
memory_record_use      memory_status
```

所有搜索和展开都会返回新的 `batchId`。`memory_assess` 只能引用该批次中的 evidence refs；`sufficient` 还必须选择 `next_strategy=answer`。`memory_record_use` 使用 `assessmentId` 作为幂等采用回执。

## GitHub Star 邀请

插件不会在安装后立刻打扰用户。只有 StrataGate 已经产生 3 条不同的采用回执时，第三次 `memory_record_use` 才会携带一次 Star 邀请。WorkBuddy Web UI / IDE 会把它显示为可关闭的 MCP App 卡片；不支持图形卡片的终端会退化为一行可选文字和链接。

这张卡片的前端桥接代码随插件安装并在本地加载，不使用第三方 CDN。插件只在本地写入一个“已经提示”的标记，不发送曝光、关闭或点击追踪；只有用户主动点击按钮时，WorkBuddy 才会打开 GitHub 仓库。

## 数据与隐私

- 数据库和 Hook cursor 位于 WorkBuddy 的插件持久化目录中；
- 项目源码不会被 StrataGate 主动扫描，只有 transcript 中已有的内容会进入记忆；
- SQLite 当前不提供静态加密；
- 默认会把待摘要/提取的记忆块发送给用户已登录的 WorkBuddy `lite` 模型；如果配置备用端点，则仅在 WorkBuddy 调用失败时尝试该端点；
- Star 邀请的触发计数和已显示标记只保存在本地，不包含遥测；
- 卸载最后一个插件作用域时，WorkBuddy 默认删除插件数据；需要保留时使用 `--keep-data`。

## 验证

```bash
npm run check:workbuddy
npm run test:workbuddy
npm run build:workbuddy
npm run verify:workbuddy
```
