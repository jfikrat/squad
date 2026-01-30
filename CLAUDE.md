# Squad MCP Server

Multi-agent MCP server - Codex ve Gemini entegrasyonu.

## Tools

| Tool | Parametreler | Açıklama |
|------|--------------|----------|
| `codex` | `message`, `workDir`, `reasoning_effort?` | GPT-5.2 Codex (xhigh/high/medium/low, default: xhigh) |
| `gemini` | `message`, `workDir`, `model?` | Gemini 3 (flash/pro, default: flash) |
| `parallel_search` | `queries`, `workDir` | 2 Gemini + 2 Codex paralel (max 4 query) |

## Proje Yapısı

```
src/
├── index.ts              # MCP sunucu entry point
├── config/
│   └── agents.ts         # Agent konfigürasyonları
├── core/
│   ├── tmux-manager.ts   # tmux session yönetimi
│   ├── codex-session.ts  # Codex JSONL session okuma
│   ├── gemini-session.ts # Gemini JSON session okuma
│   ├── response-parser.ts # Yanıt temizleme
│   └── session-watcher.ts # Dosya izleme utilities
├── agents/
│   ├── codex.ts          # Codex agent
│   └── gemini.ts         # Gemini agent
└── tools/
    ├── codex-tools.ts    # Codex tool
    ├── gemini-tools.ts   # Gemini + parallel_search tools
    └── status-tools.ts   # poll_events, wait_for_event, get_agent_status
```

## Komutlar

```bash
bun run start              # MCP sunucuyu başlat
bun run build && bun run lint  # Build ve lint
```

## Mimari Notlar

- **tmux tabanlı**: Her agent ayrı tmux session'da çalışır
- **Request ID sistemi**: `[RQ-xxx]` / `[ANS-xxx]` marker'ları ile yanıt eşleştirme
- **60 dakika timeout**: Uzun analizler için yeterli süre
- **Session terminated detection**: Terminal kapatılırsa anında hata
- **Auto-cleanup**: Terminal kapanınca tmux session da kapanır (trap EXIT)

## Bağımlılıklar

- `tmux`: Session yönetimi (zorunlu)
- Terminal emülatör: Görünür session için (varsayılan: alacritty)
- `codex`: OpenAI Codex CLI
- `gemini`: Google Gemini CLI

## Ortam Değişkenleri

| Değişken | Açıklama | Varsayılan |
|----------|----------|------------|
| `SQUAD_TERMINAL` | Terminal emülatör | `alacritty` |

**Desteklenen terminaller:** alacritty, urxvtc, kitty, wezterm, gnome-terminal, xterm
