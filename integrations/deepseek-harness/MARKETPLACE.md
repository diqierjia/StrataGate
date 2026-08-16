# Marketplace submission notes

Registry package: `stratagate-dsh`

Suggested listing:

- Name: StrataGate
- Description: Layered, evidence-gated long-term memory for DeepSeek Harness with durable Event and Element cards.
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
- [diqierjia/StrataGate-AgentMemory#deepseek-harness](https://github.com/diqierjia/StrataGate-AgentMemory/tree/main/integrations/deepseek-harness) - Layered long-term memory for DeepSeek Harness with durable Event and Element cards, source expansion, and an evidence-sufficiency gate.
```

```markdown
- [diqierjia/StrataGate-AgentMemory#deepseek-harness](https://github.com/diqierjia/StrataGate-AgentMemory/tree/main/integrations/deepseek-harness) — 为 DeepSeek Harness 提供分层长期记忆、可追溯的 Event/Element 卡片、原文展开与证据充分性检查。
```

5. Add the `dsh-plugin` GitHub topic to the StrataGate repository and open the registry PR.

These notes were checked against registry commit `39e065a38033eef36291fe5a823b35aaeaf3eb6a`. Re-check its contribution guide at release time. The distributable package contract is `package.json` plus `cordis.patch.yml`.
