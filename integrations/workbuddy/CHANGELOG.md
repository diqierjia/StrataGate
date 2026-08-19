# Changelog

## 0.1.0

- Add the WorkBuddy `UserPromptSubmit` adapter for local retrieval and `additionalContext` injection.
- Add the `Stop` adapter for idempotent transcript-tail ingestion into L5.
- Add the bundled StrataGate MCP server with evidence assessment, source expansion, and adoption receipts.
- Add background L0-L4 sealing and Event/Element generation, with an optional OpenAI-compatible fallback.
- Use WorkBuddy Headless with the built-in `lite` model by default, with schema-constrained output and no separate API key.
- Add a one-time, locally bundled MCP App invitation after three evidence-backed adoptions, with terminal fallback and no telemetry.
