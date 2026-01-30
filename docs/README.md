# Squad MCP - Araştırma Dokümanları

**Tarih:** 2026-01-30
**Amaç:** Claude Code için Gemini CLI ve Codex CLI entegrasyonu

---

## Dokümanlar

| Dosya | İçerik |
|-------|--------|
| [gemini-tmux-research.md](./gemini-tmux-research.md) | Gemini CLI araştırması |
| [codex-research.md](./codex-research.md) | Codex CLI araştırması |

---

## Hızlı Başlangıç

```bash
# Klonla
git clone https://github.com/jfikrat/squad.git
cd squad

# Bağımlılıkları yükle
bun install

# Terminal config (opsiyonel)
cp .env.example .env
# .env dosyasını düzenle: SQUAD_TERMINAL=alacritty

# Başlat
bun run start
```

---

## Özet Karşılaştırma

### Temel Farklar

| Özellik | Gemini CLI | Codex CLI |
|---------|------------|-----------|
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

## Mimari

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server (squad)                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ gemini_flash │    │ gemini_pro   │    │ codex_medium │  │
│  │ parallel_search   │              │    │ codex_xhigh  │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │           │
│         ▼                   ▼                   ▼           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 Agent Interface                      │   │
│  │  - initSession(config, workDir)                      │   │
│  │  - sendPrompt(config, workDir, prompt)               │   │
│  │  - waitForResponse(requestId, timeout)               │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│         ┌──────────────────┼──────────────────┐            │
│         ▼                  ▼                  ▼            │
│  ┌────────────┐    ┌────────────┐    ┌────────────┐       │
│  │   tmux     │    │  Session   │    │  Response  │       │
│  │  Manager   │    │  Parser    │    │  Cleaner   │       │
│  └────────────┘    └────────────┘    └────────────┘       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Checklist

### Phase 1: Core Infrastructure ✅
- [x] TypeScript proje yapısı (MCP SDK)
- [x] tmux session manager
- [x] Unified config (agents, models, workdirs)
- [x] Terminal emülatör konfigürasyonu (SQUAD_TERMINAL)

### Phase 2: Gemini Integration ✅
- [x] Gemini session watcher
- [x] Gemini response parser (◆END◆ marker)
- [x] Safe prefix injection (`Soru: `)
- [x] Request ID sistemi ([RQ-xxx] / [ANS-xxx])

### Phase 3: Codex Integration ✅
- [x] Codex session watcher (tarih bazlı)
- [x] Codex JSONL parser (agent_message)
- [x] Reasoning effort config (xhigh/medium)

### Phase 4: Advanced Features ✅
- [x] Parallel agent execution (gemini_parallel_search)
- [x] Error handling & timeouts
- [x] Event sistemi (poll_events, wait_for_event)
- [x] Agent status tracking
- [x] Multi-turn conversation (aynı tmux session devam ediyor)

### Phase 5: Future (Gerekirse)
- [ ] MCP tool passthrough (agent tool'larını Claude Code'a sun)
- [ ] Non-interactive mode fallback (`codex exec` / `gemini -p`)

---

## Ortam Değişkenleri

| Değişken | Açıklama | Varsayılan |
|----------|----------|------------|
| `SQUAD_TERMINAL` | Terminal emülatör | `alacritty` |

**Desteklenen terminaller:** alacritty, urxvtc, kitty, wezterm, gnome-terminal, xterm

```bash
# Örnek: urxvt daemon kullanımı (düşük RAM)
export SQUAD_TERMINAL=urxvtc
```

### Terminal RAM Karşılaştırması (5 pencere)

| Terminal | Total RAM |
|----------|-----------|
| urxvtd   | ~30 MB    |
| Ghostty  | ~50 MB    |
| Alacritty| ~250 MB   |

---

## Key Findings

### 1. Session Timing
- **Gemini:** Session dosyası prompt gönderildikten SONRA oluşur
- **Codex:** Session dosyası hemen oluşur

### 2. Response Detection
- **Gemini:** `◆END◆` marker + `[ANS-xxx]` kontrolü
- **Codex:** `type: "agent_message"` + `[ANS-xxx]` kontrolü

### 3. Project Hash
- **Gemini:** SHA256(workDir) → session klasörü
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
gemini -m gemini-3-flash-preview  # Model seçimi
```

### Codex Commands
```bash
codex                       # Interactive
codex exec "prompt"         # Non-interactive
codex exec --json "prompt"  # JSONL output
codex mcp-server            # MCP server mode
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
