# Changelog

## [4.0.0] — Current

### Added
- **Codex model presets** — `spark` (ultra-fast, text-only) and `full` (xhigh reasoning, genius mode) replace raw model name strings
- `enum` constraint on `model` parameter — only `"spark"` or `"full"` accepted, empty values rejected at schema level
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
