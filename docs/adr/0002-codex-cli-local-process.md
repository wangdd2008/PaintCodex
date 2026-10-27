# ADR-0002: Codex CLI via Local Child Process

## Status

Accepted — amended by [ADR-0009](/docs/adr/0009-ai-drives-canvas-through-codex-dynamic-tools.md): the child process is now a long-lived `codex app-server` driven by JSON-RPC, not a one-shot `codex exec`. The local-process decision itself is unchanged.

## Context

The AI layer needs to invoke Codex to generate SVG code from natural language prompts. Two integration options existed: (1) HTTP API to a remote Codex service, or (2) spawning a local `codex` CLI process and communicating over stdin/stdout.

## Decision

Use **local child process** invocation of the Codex CLI. The daemon spawns `codex` as a child process and communicates via JSON messages over stdin/stdout.

## Consequences

- **Positive**: Works offline once the CLI is installed. No network dependency for AI generation.
- **Positive**: Aligns with the original architecture document's Codex CLI reference.
- **Negative**: Requires every developer/user to install the Codex CLI locally.
- **Negative**: Process lifecycle management (spawn, kill, restart on crash) adds operational complexity.
- **Trade-off**: Chose local execution for offline capability, accepting the operational overhead.

## Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| HTTP API (OpenAI API) | Requires network, API keys, and ongoing costs. Loses offline capability. |
