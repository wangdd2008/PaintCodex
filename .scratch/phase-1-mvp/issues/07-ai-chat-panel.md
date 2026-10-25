# 07: AI Chat Panel

**What to build:** A collapsible AI chat panel on the right side where users can type natural language requests. The panel communicates with the Codex CLI via the daemon.

**Blocked by:** 01 (Project Scaffold)

**Status:** ready-for-agent

- [ ] Backend: Spawn Codex CLI as a child process, communicate via stdin/stdout JSON
- [ ] Backend: `POST /paint/ai/chat` endpoint accepts user prompt, forwards to Codex, streams response back
- [ ] Frontend: Collapsible AI chat panel (right side, below layer panel)
- [ ] Frontend: Chat UI with message bubbles (user input + AI response)
- [ ] Acceptance: Type "Hello" in chat, receive a response from Codex within 10 seconds
