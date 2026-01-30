# Squad MCP - Multi-Agent Server

**Tarih:** 2026-01-31
**Amaç:** Claude Code için Gemini CLI ve Codex CLI entegrasyonu

---

## Tools

| Tool | Açıklama | Parametreler |
|------|----------|--------------|
| `codex` | GPT-5.2 Codex | `message`, `workDir`, `reasoning_effort?` (xhigh/high/medium/low, default: xhigh) |
| `gemini` | Gemini 3 | `message`, `workDir`, `model?` (flash/pro, default: flash) |
| `parallel_search` | 2 Gemini + 2 Codex paralel | `queries` (max 4), `workDir` |

### Utility Tools

| Tool | Açıklama |
|------|----------|
| `poll_events` | Agent event'lerini al |
| `wait_for_event` | Belirli event bekle |
| `get_agent_status` | Agent durumunu kontrol et |

---

## Hızlı Başlangıç

```bash
# Klonla
git clone https://github.com/jfikrat/squad.git
cd squad

# Bağımlılıkları yükle
bun install

# Terminal config (opsiyonel)
export SQUAD_TERMINAL=alacritty  # veya urxvtc, kitty, wezterm

# Başlat
bun run start
```

---

## Kullanım Örnekleri

### Codex
```typescript
// Default (xhigh reasoning)
codex({ message: "Bu kodu analiz et", workDir: "/project" })

// Medium reasoning (daha hızlı)
codex({ message: "Basit soru", workDir: "/project", reasoning_effort: "medium" })
```

### Gemini
```typescript
// Default (flash)
gemini({ message: "Kod yaz", workDir: "/project" })

// Pro (daha detaylı)
gemini({ message: "UI/UX analizi", workDir: "/project", model: "pro" })
```

### Parallel Search
```typescript
// 4 query: 2 gemini_flash + 2 codex_medium
parallel_search({
  queries: ["Soru 1", "Soru 2", "Soru 3", "Soru 4"],
  workDir: "/project"
})
```

---

## Mimari

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server (squad)                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │    codex     │    │    gemini    │    │   parallel   │  │
│  │  (xhigh/     │    │  (flash/pro) │    │    search    │  │
│  │   medium)    │    │              │    │  (2+2 agent) │  │
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

## Özellikler

### Session Management
- **60 dakika timeout** - Uzun analizler için yeterli süre
- **Session terminated detection** - Kullanıcı terminali kapatırsa anında hata
- **Auto-cleanup** - Terminal kapanınca tmux session da kapanır (trap EXIT)
- **Multi-turn conversation** - Aynı session'da devam eden konuşma

### Error Handling
- `Codex session terminated by user` - Session manuel kapatıldı
- `Gemini session terminated by user` - Session manuel kapatıldı
- `Response timeout after Xms` - Timeout aşıldı

### Performance
- **Dynamic paste delay** - Uzun promptlar için otomatik bekleme süresi
- **500ms poll interval** - Düşük CPU kullanımı
- **Parallel execution** - 4 agent aynı anda çalışabilir

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

## Araştırma Dokümanları

| Dosya | İçerik |
|-------|--------|
| [gemini-tmux-research.md](./gemini-tmux-research.md) | Gemini CLI araştırması |
| [codex-research.md](./codex-research.md) | Codex CLI araştırması |

---

## CLI Karşılaştırması

| Özellik | Gemini CLI | Codex CLI |
|---------|------------|-----------|
| **Config** | `~/.gemini/settings.json` | `~/.codex/config.toml` |
| **Sessions** | `~/.gemini/tmp/{hash}/chats/*.json` | `~/.codex/sessions/{date}/*.jsonl` |
| **Safe prefix** | `Soru: ` (gerekli) | Gerekmez |
| **Response marker** | `◆END◆` + `[ANS-xxx]` | `[ANS-xxx]` |

---

## Implementation Status

### Completed
- [x] Unified tools (codex, gemini, parallel_search)
- [x] Dynamic reasoning effort / model selection
- [x] 60 dakika timeout
- [x] Session terminated detection
- [x] Terminal close cleanup (trap EXIT)
- [x] Multi-turn conversation
- [x] Event system (poll_events, wait_for_event)

### Future
- [ ] MCP tool passthrough
