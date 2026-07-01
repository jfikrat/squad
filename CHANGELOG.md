# Changelog

## [4.2.0] — Current

### Fixed
- **Viewer close no longer kills the agent session** — the `trap ... kill-session` in terminal/pane fallback viewers was removed; closing the window just detaches, the agent keeps working
- **Async dispatch returns immediately** — `waitForResponse: false` no longer blocks through TUI boot (session init, readiness wait, and send now run in the background), eliminating gateway tool-call timeouts on slow boots
- **Prompts can no longer be typed into a booting shell** — every send (initial and `continue_agent`) waits for the TUI to be sendable (ready footer or busy indicator); bare shell prompt `❯` alone no longer counts as ready
- **Prompt delivery is verified** — after paste+Enter the `[RQ-id]` marker must appear in the pane (or Codex rollout JSONL); one automatic re-send, then a descriptive error — silent prompt loss is gone
- **State detection false positives** — the echoed instruction `"[ANS-...]"` no longer counts as a completion marker; error phase is now derived only from the pane tail so task output containing "error"/"failed" (test logs, build output) no longer flags the agent as errored

### Added
- **Codex boot-retry** — when Codex exits at startup because `~/.codex` sqlite is locked by another Codex process, the command is relaunched every 10s (screen + scrollback cleared between attempts) until the ready timeout
- `SQUAD_READY_TIMEOUT_MS` (default 180s) and `SQUAD_RESPONSE_TIMEOUT_MS` (default 3h) env overrides; every wait loop now has a deadline instead of spinning forever
- Intentional-stop tracking — `cleanup`/stop no longer floods pending events with "terminated by user" errors from its own background waiters

---

## [4.1.0]

### Added
- **Unified model preset system** across all three core agents — `enum` constraint enforces valid values, empty/arbitrary strings rejected at schema level
  - `codex`: `"spark"` (ultra-fast, text-only, quick coding) / `"full"` (xhigh reasoning, genius mode)
  - `gemini`: `"flash"` (ultra-fast, creative, code gen) / `"pro"` (deeper analysis)
  - `claude`: `"sonnet"` (fast, efficient, most tasks) / `"opus"` (deep analysis, complex reasoning)

### Removed
- `codex_gemini` tool — redundant, agents can be called individually
- `parallel_search` tool — redundant, agents can be called individually

### Changed
- `model` parameter is now **required** on all three agents (was optional on `gemini`)
- Raw model name strings no longer accepted — presets only

---

## [4.0.0]

### Added
- Multi-session response lookup — searches last 30 Codex JSONL session files instead of only the latest, prevents missed responses when multiple sessions are open
- `cleanup` tool — kills only sessions owned by the current MCP instance, safe for concurrent use
- **Tmux pane display mode** (`SQUAD_DISPLAY=pane`) — splits largest pane in the active session instead of opening a new terminal window
- Instance isolation — each MCP server startup generates a unique 4-char ID prefixed to all tmux session names (e.g. `agents_a7x2_codex_xhigh`), prevents session collisions across concurrent Claude Code instances
- `settings.json` config file (`config/settings.json`) — override model, reasoning effort, terminal, and display mode without env vars
- `codex_gemini` tool — runs Codex and Gemini in parallel on the same task, returns both responses for consensus
- `allowFileEdits` parameter on Codex — when `false`, injects a hard constraint preventing any file creation/modification/deletion

### Changed
- Codex model default updated to `gpt-5.3-codex` (from `o3`)
- Spark mode skips `model_reasoning_effort` flag (spark is text-only, reasoning config not applicable)
- `sendBuffer` used for all Codex prompts (more reliable than `sendKeys` for long inputs)
- `lastActivity` timestamp updated on response received, not on send

### Fixed
- Gemini agent status lookup (`get_agent_status` now correctly resolves gemini session)
- Bracketed paste bypass for Claude Code TUI — chunked `send-keys` in 50-char pieces prevents `[Pasted text #N]` mode

---

## [3.0.0]

### Added
- **Claude Code agent** (`claude` tool) — runs Claude Code in a persistent tmux session with full project context via `CLAUDE.md`
- `parallel_search` tool — distributes up to 4 queries across 2 Gemini Flash + 2 Codex Medium instances simultaneously
- `poll_events` / `wait_for_event` tools — async event polling for agent completions
- `get_agent_status` tool — connection state, tmux session name, last activity, pending event count
- Session timeout (30 min inactivity) with graceful shutdown

### Changed
- Unified tool API — all agents share consistent `message`, `workDir`, `allowFileEdits` interface
- README rewritten in English

---

## [2.0.0]

### Added
- **Codex agent** — tmux-based session with JSONL response detection via `~/.codex/sessions`
- Request ID system (`[RQ-xxxx]` / `[ANS-xxxx]`) for reliable response matching in shared session output
- `readyPatterns` per agent — waits for CLI startup before sending prompts

### Changed
- Response detection split into `"marker"` (Gemini) and `"jsonl"` (Codex/Claude) strategies

---

## [1.0.0]

### Added
- **Gemini agent** — tmux session with `◆END◆` marker-based response detection
- MCP server scaffold with stdio transport
- `SQUAD_TERMINAL` env for configurable terminal emulator
