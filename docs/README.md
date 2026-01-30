# Agents MCP - Araştırma Dokümanları

**Tarih:** 2026-01-30
**Amaç:** Claude Code için Gemini CLI ve Codex CLI entegrasyonu

---

## Dokümanlar

| Dosya | İçerik |
|-------|--------|
| [gemini-tmux-research.md](./gemini-tmux-research.md) | Gemini CLI araştırması |
| [codex-research.md](./codex-research.md) | Codex CLI araştırması |

---

## Özet Karşılaştırma

### Temel Farklar

| Özellik | Gemini CLI | Codex CLI |
|---------|------------|-----------|
| **Kurulum** | `npm i -g @anthropic-ai/gemini-cli` | `npm i -g @openai/codex` |
| **Interactive** | `gemini` | `codex` |
| **Non-Interactive** | `gemini -p "prompt"` | `codex exec "prompt"` |
| **JSON Output** | `-o json` (settings) | `--json` (JSONL) |
| **Config** | `~/.gemini/settings.json` | `~/.codex/config.toml` |
| **Sessions** | `~/.gemini/tmp/{hash}/chats/*.json` | `~/.codex/sessions/{date}/*.jsonl` |

### Slash Command Davranışı

| Input | Gemini | Codex |
|-------|--------|-------|
| `/help` | ❌ Slash command | ❌ Slash command |
| `/help nedir?` | ❌ Slash command | ✅ Normal prompt |
| `Soru: /help nedir?` | ✅ Normal prompt | ✅ Normal prompt |

**Sonuç:**
- Gemini'de `Soru: ` prefix'i ŞART
- Codex'te prefix gerekmez

### tmux Kullanımı

```bash
# Her ikisi için ortak pattern
tmux new-session -d -s SESSION -c /workdir
tmux send-keys -t SESSION 'gemini' Enter  # veya 'codex'
tmux send-keys -t SESSION 'prompt' Enter
tmux capture-pane -t SESSION -p
```

### Parse Stratejileri

**Gemini:**
```typescript
// Session JSON'dan son mesajı al
const session = JSON.parse(fs.readFileSync(sessionFile))
const lastMsg = session.messages.filter(m => m.type === 'gemini').pop()
const response = lastMsg.content.replace(/◆END◆/g, '').trim()
```

**Codex:**
```typescript
// JSONL'den agent_message event'lerini filtrele
const events = lines.map(line => JSON.parse(line))
const lastMsg = events
  .filter(e => e.payload?.type === 'agent_message')
  .pop()
const response = lastMsg.payload.message
```

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server (agents-mcp)                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ gemini_flash │    │ gemini_pro   │    │ codex_medium │  │
│  │ gemini_search│    │              │    │ codex_xhigh  │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │           │
│         ▼                   ▼                   ▼           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Unified Agent Interface                 │   │
│  │  - startSession(agent, workDir)                      │   │
│  │  - sendPrompt(sessionId, prompt)                     │   │
│  │  - waitForResponse(sessionId)                        │   │
│  │  - getSessionHistory(sessionId)                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│         ┌──────────────────┼──────────────────┐            │
│         ▼                  ▼                  ▼            │
│  ┌────────────┐    ┌────────────┐    ┌────────────┐       │
│  │   tmux     │    │  Session   │    │  Response  │       │
│  │  Manager   │    │  Watcher   │    │   Parser   │       │
│  └────────────┘    └────────────┘    └────────────┘       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] TypeScript proje yapısı (MCP SDK)
- [ ] tmux session manager
- [ ] Unified config (agents, models, workdirs)

### Phase 2: Gemini Integration
- [ ] Gemini session watcher
- [ ] Gemini response parser (◆END◆ marker)
- [ ] Safe prefix injection (`Soru: `)
- [ ] Non-interactive mode fallback

### Phase 3: Codex Integration
- [ ] Codex session watcher (tarih bazlı)
- [ ] Codex JSONL parser (agent_message)
- [ ] Trust level handling
- [ ] Reasoning effort config

### Phase 4: Advanced Features
- [ ] Multi-turn conversation support
- [ ] Session resume/fork
- [ ] Parallel agent execution
- [ ] Error handling & timeouts
- [ ] MCP tool passthrough

---

## Key Findings

### 1. Session Timing
- **Gemini:** Session dosyası prompt gönderildikten SONRA oluşur
- **Codex:** Session dosyası hemen oluşur

### 2. Response Detection
- **Gemini:** `◆END◆` marker + `type: "gemini"` kontrolü
- **Codex:** `type: "agent_message"` event kontrolü

### 3. Project Hash
- **Gemini:** Bilinmeyen hash algoritması → watcher ile çöz
- **Codex:** Tarih bazlı dizin → direkt hesaplanabilir

### 4. MCP Support
- **Gemini:** Sadece MCP client
- **Codex:** MCP client + MCP server (`codex mcp-server`)

---

## Quick Reference

### Gemini Commands
```bash
gemini                      # Interactive
gemini -p "prompt"          # Non-interactive
gemini -p "prompt" -o json  # JSON output (settings'te)
```

### Codex Commands
```bash
codex                       # Interactive
codex exec "prompt"         # Non-interactive
codex exec --json "prompt"  # JSONL output
codex mcp-server            # MCP server mode
codex resume --last         # Son session'ı devam ettir
```

### tmux Commands
```bash
tmux new-session -d -s NAME -c /path    # Detached session
tmux send-keys -t NAME 'cmd' Enter      # Komut gönder
tmux set-buffer -b BUF "text"           # Buffer'a yaz
tmux paste-buffer -t NAME -b BUF        # Yapıştır
tmux capture-pane -t NAME -p            # Output al
tmux kill-session -t NAME               # Session kapat
```

### Terminal Emulator (X11)

**urxvt daemon modu** - en verimli çoklu pencere çözümü:

```bash
# Daemon başlat (bir kez, login'de)
urxvtd -q -o -f

# Her agent için client penceresi (~2MB each)
urxvtc -title "Gemini Flash" -e tmux attach -t gemini_flash
urxvtc -title "Codex XHigh" -e tmux attach -t codex_xhigh
```

**RAM Karşılaştırması (5 pencere):**
| Terminal | Total RAM |
|----------|-----------|
| urxvtd   | ~30 MB    |
| Alacritty| ~250 MB   |
| Ghostty  | ~50 MB    |
