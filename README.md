# Squad MCP Server

Multi-agent MCP server - Codex ve Gemini entegrasyonu.

## Kurulum

```bash
# Bağımlılıkları yükle
bun install

# Claude Code'a ekle
claude mcp add -s user squad -- bun run /path/to/squad/src/index.ts
```

## Gereksinimler

- [Bun](https://bun.sh/) - JavaScript runtime
- [tmux](https://github.com/tmux/tmux) - Terminal multiplexer
- [Codex CLI](https://github.com/openai/codex) - OpenAI Codex
- [Gemini CLI](https://github.com/google/gemini-cli) - Google Gemini
- Terminal emülatör (alacritty, kitty, wezterm, vb.) - `display: "terminal"` modu için

## Tools

| Tool | Parametreler | Açıklama |
|------|--------------|----------|
| `codex` | `message`, `workDir` | Codex (model + reasoning: settings) |
| `gemini` | `message`, `workDir`, `model?` | Gemini (model: settings veya parametre) |
| `codex_gemini` | `message`, `workDir`, `gemini_model?` | Codex + Gemini paralel (consensus için) |
| `parallel_search` | `queries`, `workDir` | Gemini + Codex paralel arama (max 4 query) |
| `cleanup` | - | Bu instance'a ait tüm agent session'larını kapat |
| `poll_events` | `agent`, `peek?` | Agent event'lerini poll et |
| `wait_for_event` | `agent`, `eventType`, `timeoutMs?` | Belirli bir event bekle |
| `get_agent_status` | `agent` | Agent durumunu sorgula |

## Konfigürasyon

Ayarları değiştirmek için `config/settings.json` dosyasını düzenleyin:

```bash
nano config/settings.json   # veya
code config/settings.json   # VS Code ile
```

```json
{
  "codex": {
    "model": "gpt-5.3-codex",
    "reasoning": "xhigh"
  },
  "gemini": {
    "model": "gemini-3-flash-preview"
  },
  "terminal": "alacritty",
  "display": "pane"
}
```

**Değişiklik sonrası MCP server'ı yeniden başlatın:**
```bash
# Claude Code'da:
/mcp
# "Reconnected to squad" mesajını görmelisiniz
```

### Kullanılabilir Değerler

| Ayar | Değerler | Açıklama |
|------|----------|----------|
| `codex.model` | `gpt-5.3-codex`, `gpt-5.2` | Codex modeli |
| `codex.reasoning` | `xhigh`, `high`, `medium`, `low` | Akıl yürütme seviyesi |
| `gemini.model` | `gemini-3-flash-preview`, `gemini-3-pro-preview` | Gemini modeli |
| `terminal` | `alacritty`, `kitty`, `wezterm`, ... | Terminal emülatör |
| `display` | `pane`, `terminal`, `none` | Agent görüntüleme modu |

### Display Modları

| Mod | Açıklama |
|-----|----------|
| `terminal` | Her agent için yeni terminal penceresi açar (default) |
| `pane` | Agent'ları mevcut tmux session'da pane olarak açar (auto-grid) |
| `none` | Görsel UI açmaz, agent'lar arka planda çalışır |

**Pane modu** tmux içinde Claude Code çalıştırırken idealdir. Agent'lar otomatik ızgara layout ile düzenlenir:

```
2 agent:                          3+ agent:
┌──────────┬───────────┐          ┌──────────┬─────┬─────┐
│          │  Codex    │          │          │ A1  │ A2  │
│  Claude  ├───────────┤          │  Claude  ├─────┼─────┤
│  Code    │  Gemini   │          │  Code    │ A3  │ A4  │
│  (40%)   │  (60%)    │          │  (40%)   │   (60%)   │
└──────────┴───────────┘          └──────────┴───────────┘
```

İlk agent CC'nin sağına %60 ile açılır, sonraki agent'lar en büyük pane'i aspect ratio'ya göre otomatik böler.

### Ortam Değişkenleri (opsiyonel override)

Öncelik: ENV > settings.json > default

| Değişken | Açıklama |
|----------|----------|
| `SQUAD_CODEX_MODEL` | Codex model |
| `SQUAD_CODEX_REASONING` | Codex reasoning effort |
| `SQUAD_GEMINI_MODEL` | Gemini model |
| `SQUAD_TERMINAL` | Terminal emülatör |
| `SQUAD_DISPLAY` | Display modu (`pane`, `terminal`, `none`) |

## Geliştirme

```bash
bun run start              # MCP sunucuyu başlat
bun run build && bun run lint  # Build ve lint
```

## Proje Yapısı

```
config/
└── settings.json         # Kullanıcı ayarları (model, reasoning, terminal, display)

src/
├── index.ts              # MCP sunucu entry point
├── config/
│   └── agents.ts         # Agent konfigürasyonları + display mode
├── core/
│   ├── tmux-manager.ts   # tmux session yönetimi + pane grid layout
│   ├── instance.ts       # MCP instance ID (session isolation)
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
    └── status-tools.ts   # poll_events, wait_for_event, get_agent_status, cleanup
```

## Mimari

- **tmux tabanlı**: Her agent ayrı tmux session'da çalışır
- **Instance isolation**: Her MCP instance unique ID alır, session'lar çakışmaz
- **Pane grid layout**: `display: "pane"` modunda agent'lar otomatik ızgara düzeninde açılır
- **Read-only agent'lar**: Codex prompt'larına dosya değiştirme yasağı eklenir
- **Bracketed paste**: Multiline input için `tmux paste-buffer -p`
- **Request ID sistemi**: `[RQ-xxx]` / `[ANS-xxx]` marker'ları ile yanıt eşleştirme
- **60 dakika timeout**: Tek bir işlem için max bekleme süresi
- **30 dakika inaktivite**: Kullanılmayan session'lar otomatik kapanır
- **Instance-scoped cleanup**: `cleanup` tool'u sadece kendi instance session'larını kapatır

### Session Lifecycle

```
Input gönder → lastActivity güncellenir
     ↓
Agent düşünüyor (30+ dk olabilir)
     ↓
Cevap alındı → lastActivity güncellenir
     ↓
30 dk inaktivite → session otomatik kapatılır
```

`lastActivity` hem input hem output'ta güncellenir, böylece uzun süren işlemler cleanup'tan korunur.

## Lisans

MIT
