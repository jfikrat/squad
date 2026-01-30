# Squad MCP Server

Multi-agent MCP server - Codex ve Gemini entegrasyonu.

## Proje Yapısı

```
src/
├── index.ts              # MCP sunucu entry point
├── config/
│   └── agents.ts         # Agent konfigürasyonları (komutlar, timeout, regex)
├── core/
│   ├── tmux-manager.ts   # tmux session yönetimi
│   ├── codex-session.ts  # Codex JSONL session okuma
│   ├── gemini-session.ts # Gemini JSON session okuma
│   ├── response-parser.ts # Yanıt temizleme
│   └── session-watcher.ts # Dosya izleme utilities
├── agents/
│   ├── codex.ts          # Codex agent (xhigh/medium)
│   └── gemini.ts         # Gemini agent (flash/pro/parallel)
└── tools/
    ├── codex-tools.ts    # MCP tool tanımları (Codex)
    ├── gemini-tools.ts   # MCP tool tanımları (Gemini)
    └── status-tools.ts   # Agent status/event tools
```

## Komutlar

```bash
bun run start              # MCP sunucuyu başlat
bun run build && bun run lint  # Build ve lint
```

## Agent'lar

| Agent | Amaç | Kullanım |
|-------|------|----------|
| `codex_xhigh` | Derin analiz, debug, mimari review | Karmaşık problemler |
| `codex_medium` | Orta seviye analiz | Genel sorular |
| `gemini_flash` | Hızlı kod üretimi | Quick code gen |
| `gemini_pro` | UI/UX, design, planlama | Yaratıcı işler |
| `gemini_parallel_search` | Paralel web araması (max 5) | Research |

## Mimari Notlar

- **tmux tabanlı**: Her agent ayrı tmux session'da çalışır, crash durumunda state korunur
- **Request ID sistemi**: `[RQ-xxx]` / `[ANS-xxx]` marker'ları ile yanıt eşleştirme
- **Polling**: Session dosyaları (JSON/JSONL) periyodik kontrol edilir
- **Visible sessions**: Gemini agent'ları alacritty'de görünür tmux session açar

## Konfigürasyon

Agent ayarları `src/config/agents.ts` dosyasında:
- Komut şablonları
- Timeout süreleri
- Yanıt regex pattern'leri

## Bağımlılıklar

- `tmux`: Session yönetimi (zorunlu)
- `alacritty`: Görünür terminal (Gemini için)
- `codex`: OpenAI Codex CLI
- `gemini`: Google Gemini CLI
