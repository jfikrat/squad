# Gemini CLI + tmux MCP Araştırma Notları

**Tarih:** 2026-01-30
**Amaç:** Claude Code'un Gemini CLI'yi tmux üzerinden interactive modda kullanması

---

## 1. Gemini CLI Özellikleri

```bash
gemini --help
```

### Önemli Flagler

| Flag | Açıklama |
|------|----------|
| `-p "prompt"` | Non-interactive mode (tek seferlik) |
| `-i "prompt"` | Interactive mode + başlangıç prompt'u |
| `-o json` | JSON output formatı |
| `--yolo` | Tüm aksiyonları otomatik onayla |
| `--approval-mode` | `default`, `auto_edit`, `yolo`, `plan` |
| `--include-directories` | Ek dizinler (workdir yok!) |
| `-m, --model` | Model seçimi |
| `-r, --resume` | Önceki session'ı devam ettir |
| `--list-sessions` | Session'ları listele |

### Neden Interactive Mode Şart?

1. **Multi-turn conversation** gerekli
2. **MCP tool'ları sadece interactive modda** çalışıyor
3. Uzun görevlerde ilerleme takibi

---

## 2. tmux Scripting Komutları

### Temel Komutlar

```bash
# Session yönetimi
tmux new-session -d -s SESSION_NAME           # Detached session başlat
tmux new-session -d -s SESSION_NAME -c /path  # Belirli dizinde başlat
tmux has-session -t SESSION_NAME              # Session var mı?
tmux kill-session -t SESSION_NAME             # Session kapat
tmux list-sessions                            # Tüm session'ları listele

# Komut gönderme
tmux send-keys -t SESSION_NAME 'command' Enter

# Output alma
tmux capture-pane -t SESSION_NAME -p          # Pane içeriğini stdout'a
tmux capture-pane -t SESSION_NAME -p -S -100  # Son 100 satır
```

### capture-pane Sorunları

- ANSI escape codes
- Formatting bozuklukları
- Parse zorluğu

---

## 3. Gemini Session Dosyaları

### Konum

```
~/.gemini/tmp/{PROJECT_HASH}/chats/session-{DATE}-{UUID}.json
```

### Yapı

```json
{
  "sessionId": "uuid",
  "projectHash": "sha256-hash",
  "startTime": "ISO-date",
  "lastUpdated": "ISO-date",
  "messages": [
    {
      "id": "uuid",
      "timestamp": "ISO-date",
      "type": "user",
      "content": "kullanıcı mesajı"
    },
    {
      "id": "uuid",
      "timestamp": "ISO-date",
      "type": "gemini",
      "content": "cevap metni\n\n◆END◆",
      "thoughts": [
        {
          "subject": "...",
          "description": "...",
          "timestamp": "..."
        }
      ],
      "tokens": {
        "input": 7736,
        "output": 19,
        "cached": 0,
        "thoughts": 102,
        "tool": 0,
        "total": 7857
      },
      "model": "gemini-3-flash-preview",
      "toolCalls": [
        {
          "name": "tool_name",
          "args": {...},
          "result": [...],
          "status": "success"
        }
      ]
    },
    {
      "type": "info",
      "content": "system mesajı"
    }
  ],
  "summary": "session özeti"
}
```

### Project Hash

- SHA256 tabanlı ama exact algoritma bilinmiyor
- **Çözüm:** Watcher ile yeni dosyayı tespit et

---

## 4. Önemli Keşif: Session Oluşturma Zamanı

> **Session dosyası Gemini başlatıldığında değil, ilk prompt gönderildiğinde oluşuyor!**

Bu demek ki:
1. tmux'ta gemini başlat
2. prompt gönder
3. **← Session dosyası BURADA oluşuyor**
4. Watcher dosyayı yakalar

---

## 5. Parse Stratejisi

### Seçenek Karşılaştırması

| Özellik | capture-pane | Session JSON |
|---------|-------------|--------------|
| Parse kolaylığı | ❌ ANSI codes | ✅ Clean JSON |
| Tool calls | ❌ Terminal output | ✅ `toolCalls` array |
| Thoughts | ❌ Yok | ✅ `thoughts` array |
| Token bilgisi | ❌ Yok | ✅ `tokens` object |
| Real-time | ✅ Anında | ⚠️ Poll gerekli |

**Karar:** Session JSON birincil, capture-pane backup

### Marker Sistemi

Gemini'ye system instruction olarak:

```
Sen bir MCP agent'ısın. Cevaplarını şu formatta ver:

◆RESPONSE◆
[asıl cevabın]
◆END◆

Kurallar:
- ◆RESPONSE◆ ve ◆END◆ marker'larını MUTLAKA kullan
- Marker'ların dışında açıklama yazma
- Hata varsa: ◆ERROR◆ [hata mesajı] ◆END◆
```

### Parse Regex

```typescript
const content = lastMessage.content
const match = content.match(/◆RESPONSE◆\n?([\s\S]*?)\n?◆END◆/)
if (match) return match[1]
```

---

## 6. Proposed Architecture

```
┌─────────────────────────────────────────────────────┐
│  MCP Tool Call: gemini_flash(message, workDir)      │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│  1. tmux new-session -d -s gemini_{uuid} -c workDir │
│  2. tmux send-keys "gemini" Enter                   │
│  3. tmux send-keys "{prompt}" Enter                 │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│  Watcher: fs.watch(~/.gemini/tmp/, recursive)       │
│  - Yeni .json dosyası oluştu mu?                    │
│  - Session path'i yakala                            │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│  Poll: Session JSON                                 │
│  - lastUpdated değişti mi?                          │
│  - Son mesaj type: "gemini" mi?                     │
│  - ◆END◆ veya ◆RESPONSE◆...◆END◆ var mı?           │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│  Return: {                                          │
│    content: string,                                 │
│    toolCalls: ToolCall[],                           │
│    thoughts: Thought[],                             │
│    tokens: TokenUsage                               │
│  }                                                  │
└─────────────────────────────────────────────────────┘
```

---

## 7. Implementation Checklist

- [ ] tmux session manager (create, kill, send-keys)
- [ ] Session file watcher (fs.watch)
- [ ] Session JSON parser
- [ ] Marker-based response extractor
- [ ] Polling logic with timeout
- [ ] Multi-turn conversation support (aynı session)
- [ ] Error handling (timeout, gemini crash)
- [ ] GEMINI.md system instruction injection

---

## 8. Alternatif: Fork Gemini CLI

Eğer watcher yaklaşımı sorun çıkarırsa:

1. Gemini CLI'yi forkla
2. `--session-output /path` flag'i ekle
3. Veya stdout'a session path yazdır

Repo: https://github.com/google-gemini/gemini-cli

---

## 9. tmux Test Sonuçları (2026-01-30)

### Çalışan Komutlar

```bash
# Session başlat
tmux new-session -d -s SESSION_NAME -c /path/to/workdir

# Gemini başlat
tmux send-keys -t SESSION_NAME 'gemini' Enter

# Prompt gönder (GÜVENLİ YOL)
tmux set-buffer -b prompt "Soru: prompt içeriği burada"
tmux paste-buffer -t SESSION_NAME -b prompt
tmux send-keys -t SESSION_NAME Enter  # veya C-m

# Output al
tmux capture-pane -t SESSION_NAME -p -S -50

# Session kapat
tmux kill-session -t SESSION_NAME
```

### Slash Command Sorunu ve Çözümü

| Input | Sonuç |
|-------|-------|
| `/help ...` | ❌ Slash command olarak çalışır |
| ` /help ...` | ❌ Boşluk trim edilir, yine slash command |
| `Soru: /help ...` | ✅ Normal prompt olarak işlenir |

**Çözüm:** Her prompt'un başına safe prefix ekle:
- `Soru: ` (Türkçe)
- `Q: ` (kısa)
- `>>> ` (sembol)

### Enter vs C-m

Her ikisi de çalışıyor:
- `tmux send-keys -t SESSION Enter`
- `tmux send-keys -t SESSION C-m`

### paste-buffer Kullanımı

```bash
# Buffer'a yaz
tmux set-buffer -b mybuf "çok satırlı
metin buraya
yazılabilir"

# Yapıştır
tmux paste-buffer -t SESSION -b mybuf

# Enter gönder
tmux send-keys -t SESSION Enter
```

**Avantajlar:**
- Özel karakterler güvenli
- Multiline destekli
- Shell expansion yok

---

## 10. Session Watcher Test Sonuçları (2026-01-30)

### Keşif: Session Dosyası Oluşturma Zamanı

```
Timeline:
──────────────────────────────────────────────────────────
1. tmux session başlat
   └─→ Henüz session dosyası YOK

2. gemini başlat
   └─→ ~/.gemini/tmp/{HASH}/ dizini oluşur
   └─→ chats/ dizini oluşur (BOŞ)

3. Prompt gönder + Enter
   └─→ session-{DATE}-{UUID}.json OLUŞUR ← BURASI!

4. Gemini cevap verir
   └─→ Aynı dosya güncellenir
──────────────────────────────────────────────────────────
```

### Test Edilen Session Dosyası

```json
{
  "sessionId": "a61d47a8-cf14-4fd3-aa3c-c16d86905f1a",
  "projectHash": "fcd4acf0ba8ef358982c5da1cf61d59a43ab8f3ed7e9f5468aa63001c068df87",
  "startTime": "2026-01-30T09:13:38.214Z",
  "lastUpdated": "2026-01-30T09:13:41.035Z",
  "messages": [
    {
      "type": "user",
      "content": "Soru: Merhaba, 5+5 kaç eder?"
    },
    {
      "type": "gemini",
      "content": "Merhaba, 5+5 = 10 eder.\n\n◆END◆",
      "thoughts": [...],
      "tokens": { "input": 6177, "output": 16, "total": 6284 },
      "model": "gemini-3-flash-preview"
    }
  ]
}
```

### Watcher Implementasyon Stratejisi

```typescript
async function watchForNewSession(existingFiles: Set<string>): Promise<string> {
  const GEMINI_TMP = path.join(os.homedir(), '.gemini', 'tmp')

  while (true) {
    const currentFiles = glob.sync(`${GEMINI_TMP}/*/chats/*.json`)
    const newFile = currentFiles.find(f => !existingFiles.has(f))

    if (newFile) {
      return newFile  // Yeni session dosyası bulundu!
    }

    await sleep(200)
  }
}

async function waitForResponse(sessionFile: string): Promise<GeminiMessage> {
  while (true) {
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'))
    const lastMsg = session.messages.at(-1)

    if (lastMsg?.type === 'gemini' && lastMsg.content.includes('◆END◆')) {
      return lastMsg  // Cevap hazır!
    }

    await sleep(300)
  }
}
```

### Project Hash Notu

- Her `workDir` için benzersiz hash oluşuyor
- Hash algoritması bilinmiyor (SHA256 değil)
- **Çözüm:** Dosya listesi karşılaştırma ile yeni session'ı bul

---

## 11. Gemini CLI Settings Katmanları

### Katman Hiyerarşisi

| Katman | Konum | Scope | Öncelik |
|--------|-------|-------|---------|
| **System Defaults** | `/etc/gemini-cli/system-defaults.json` | Tüm kullanıcılar, baseline | 1 (en düşük) |
| **User** | `~/.gemini/settings.json` | Tek kullanıcı, tüm projeler | 2 |
| **Project/Workspace** | `.gemini/settings.json` (proje kökünde) | Tek proje | 3 |
| **System** | `/etc/gemini-cli/settings.json` | Tüm kullanıcılar, override | 4 |
| **Env Variables** | `.env` veya shell | Session | 5 |
| **CLI Arguments** | `--flag` | Tek çalıştırma | 6 (en yüksek) |

### Mevcut User Settings (~/.gemini/settings.json)

```json
{
  "output": { "format": "json" },
  "tools": { "approvalMode": "yolo" },
  "mcpServers": {
    "exa": { "command": "npx", "args": ["-y", "exa-mcp-server"], ... },
    "helm": { "command": "bun", "args": ["run", "..."], ... }
  }
}
```

### GEMINI.md - Marker Instruction

`~/.gemini/GEMINI.md` dosyasında `◆END◆` marker'ı zaten tanımlı:

```markdown
# ZORUNLU KURALLAR
1. **Her yanıtın sonuna `◆END◆` yaz** - Bu ZORUNLU, istisnasız.
```

---

## 12. Non-Interactive JSON Mode Keşfi

### output.format: "json" Etkisi

`~/.gemini/settings.json` içinde `"output": { "format": "json" }` ayarı non-interactive modda clean JSON output veriyor!

### Test Komutu

```bash
gemini -p "10+20 kaç?"
```

### JSON Output

```json
{
  "session_id": "9b49bfbd-bc10-449b-96a1-eb70c651b423",
  "response": "10 + 20 = 30.\n\n◆END◆",
  "stats": {
    "models": {
      "gemini-3-flash-preview": {
        "api": { "totalRequests": 1, "totalLatencyMs": 3141 },
        "tokens": { "input": 5124, "candidates": 15, "total": 5228 }
      }
    },
    "tools": { "totalCalls": 0, "totalSuccess": 0 },
    "files": { "totalLinesAdded": 0, "totalLinesRemoved": 0 }
  }
}
```

### İki Mod Stratejisi

| Mod | Kullanım | Avantaj | Dezavantaj |
|-----|----------|---------|------------|
| **Non-Interactive + JSON** | Basit sorgular | Parse kolay, tmux gereksiz | MCP tool çalışmaz |
| **Interactive + tmux** | MCP tool gereken görevler | Tam özellik | Karmaşık setup |

### Implementasyon

```typescript
async function queryGemini(prompt: string, workDir: string, requiresMCP: boolean) {
  if (requiresMCP) {
    // Interactive mode - tmux + session watcher
    return runInteractiveMode(prompt, workDir)
  } else {
    // Non-interactive mode - direkt JSON
    const result = execSync(
      `cd "${workDir}" && gemini -p "${escapePrompt(prompt)}"`,
      { encoding: 'utf-8' }
    )
    const json = JSON.parse(result)
    return {
      response: json.response.replace(/\n*◆END◆\n*$/, ''),
      sessionId: json.session_id,
      stats: json.stats
    }
  }
}
```

### Avantajlar

1. **Basit sorgular için tmux gereksiz** - direkt subprocess
2. **Parse garantili** - JSON output, regex yok
3. **Stats dahil** - token kullanımı, latency bilgisi
4. **Session ID** - tracking için

---

## 13. Referanslar

- [tmux scripting guide](https://tao-of-tmux.readthedocs.io/en/latest/manuscript/10-scripting.html)
- [Gemini CLI GitHub](https://github.com/google-gemini/gemini-cli)
- [Gemini CLI Config](https://google-gemini.github.io/gemini-cli/docs/get-started/configuration.html)
- [libtmux (Python)](https://libtmux.git-pull.com/)
