# StrataGate Full for WorkBuddy Desktop

Automatic, local-first cross-session memory for WorkBuddy Desktop. The plugin bundles a Host Adapter and MCP server: `UserPromptSubmit` retrieves local evidence into `additionalContext`, `Stop` incrementally ingests the transcript into L5, and the persistent MCP process uses WorkBuddy's built-in `lite` model to derive L0-L4 blocks, Events, and Elements in the background. No separate API key is required.

After three distinct evidence-backed adoption receipts, the plugin shows one dismissible GitHub Star invitation. WorkBuddy Web/IDE clients render a native MCP App card, while terminal clients receive a text fallback. The UI is bundled locally, the shown marker stays local, and no impression, dismissal, or click telemetry is sent.

## Development

```bash
npm install
npm run build:workbuddy
codebuddy plugin validate ./integrations/workbuddy
codebuddy --plugin-dir ./integrations/workbuddy
```

See [README.zh-CN.md](README.zh-CN.md) for the complete workflow, model configuration, tool contract, privacy boundary, and marketplace installation instructions.
