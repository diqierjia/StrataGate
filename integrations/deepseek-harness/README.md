# StrataGate for DeepSeek Harness

Native, local-first long-term memory for DeepSeek Harness. The plugin adapts DSH session events to the existing StrataGate memory engine; it does not implement a second memory system.

## Install

From a DSH profile:

```bash
dsh plugin --profile web add stratagate-dsh
```

The package includes `cordis.patch.yml`, so DSH can add the Host row automatically. Restart the profile after installation. The default database is:

```text
DSH_HOME/stratagate/memory.db
```

Removing the plugin does not delete that database.

## What happens automatically

- Completed human turns are folded from `turn/start`, human `user/message`, assistant messages, tool calls/results, and `turn/end`.
- Plugin-injected context is not mistaken for a human message.
- StrataGate's own `memory_*` calls/results are omitted from the stored tool trace, preventing recalled memory from being re-ingested as new evidence.
- Subagent turns are not ingested by default; subagents in the same project can still read project memory.
- Each DSH turn has a durable ingestion receipt, so replay or retry cannot store it twice.
- StrataGate performs the existing Block summarization, Event extraction, Element projection, search, Evidence Gate, and use-only reinforcement.

The plugin registers these tools:

```text
memory_search_events   memory_expand_event
memory_search_elements memory_expand_element
memory_search_raw      memory_get_blocks
memory_expand_block    memory_assess
memory_record_use
```

The prompt protocol requires assessment after every retrieval. Search does not strengthen a memory. `memory_record_use` records only evidence from the last sufficient assessment and uses the DSH tool call id as an idempotency receipt.

## Configuration

```yaml
config:
  database: !!js dshHomePath('stratagate', 'memory.db')
  namespaceMode: project # project | session | global
  namespacePrefix: dsh
  globalNamespace: global
  blockTurnSize: 4
  ingestSubagents: false
  maxOutputTokens: 2048
  # Optional: use a dedicated model for memory processing.
  # provider: deepseek
  # model: deepseek-chat
```

`project` derives a stable namespace from the normalized session working directory. `session` isolates every DSH session. `global` shares one namespace.

If `provider` and `model` are omitted, memory processing uses the session's latest request route, then the DSH default model as fallback. They must be configured as a pair.

## Privacy and failure behavior

Memory is stored in the configured local SQLite file. Normal DSH model-provider calls are used only when StrataGate seals a block, extracts Events, or projects Elements. Raw source messages remain available at L5 for verification.

If a memory-model call fails, the raw turn and the pending job remain durable. A later open resumes the job without appending the turn again. Retrieval waits for queued ingestion so a just-completed turn is not raced by a search.

## Development

From the repository root:

```bash
npm install
npm run check:dsh
npm run test:dsh
npm run build:dsh
npm pack --workspace stratagate-dsh
```
