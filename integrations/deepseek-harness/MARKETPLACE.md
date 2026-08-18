# Marketplace submission notes

Registry package: `stratagate-dsh`

Suggested listing:

- Name: StrataGate
- Description: Automatic, local-first cross-session memory for DeepSeek Harness: remembers user preferences, project decisions, conversations, and tool results; verifies recalled information against original messages before answering.
- Chinese description: DeepSeek Harness 的自动本地跨会话记忆：记住用户偏好、项目决策、历史对话与工具结果；回答前检查证据，并可追溯到原始消息。
- Category: Memory
- Source: `https://github.com/diqierjia/StrataGate-AgentMemory/tree/main/integrations/deepseek-harness`
- Install package: `stratagate-dsh`
- License: MIT

Release order:

1. Run the root and integration checks/tests.
2. Pack the workspace and install the tarball into a clean DSH profile.
3. Publish the npm package.
4. Add one line under `### Memory` in both `awesome-dsh-plugin/awesome-dsh-plugin` README files:

```markdown
- [diqierjia/StrataGate-AgentMemory#deepseek-harness](https://github.com/diqierjia/StrataGate-AgentMemory/tree/main/integrations/deepseek-harness) - Automatic, local-first cross-session memory for DeepSeek Harness: remembers user preferences, project decisions, conversations, and tool results; verifies recalled information against original messages before answering.
```

```markdown
- [diqierjia/StrataGate-AgentMemory#deepseek-harness](https://github.com/diqierjia/StrataGate-AgentMemory/tree/main/integrations/deepseek-harness) — DeepSeek Harness 的自动本地跨会话记忆：记住用户偏好、项目决策、历史对话与工具结果；回答前检查证据，并可追溯到原始消息。
```

5. Add the `dsh-plugin` GitHub topic to the StrataGate repository and open the registry PR.

These notes were checked against registry commit `39e065a38033eef36291fe5a823b35aaeaf3eb6a`. Re-check its contribution guide at release time. The distributable package contract is `package.json` plus `cordis.patch.yml`.
