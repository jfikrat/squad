# Codex CLI Araştırma Notları

**Tarih:** 2026-01-30
**Amaç:** Claude Code'un Codex CLI'yi kullanması

---

## 1. Codex CLI Özellikleri

### Kurulum

```bash
npm i -g @openai/codex
# veya
brew install --cask codex
```

### Temel Komutlar

```bash
codex                    # Interactive mode
codex exec "prompt"      # Non-interactive mode
codex exec --json "..."  # JSONL output
codex resume             # Önceki session'ı devam ettir
codex mcp                # MCP server yönetimi
codex mcp-server         # MCP server olarak çalıştır (stdio)
```

### Önemli Flagler

| Flag | Açıklama |
|------|----------|
| `--json` | JSONL streaming output |
| `-o, --output-last-message FILE` | Son mesajı dosyaya yaz |
| `-C, --cd DIR` | Çalışma dizini |
| `--skip-git-repo-check` | Git repo kontrolünü atla |
| `-m, --model MODEL` | Model seçimi |
| `-s, --sandbox MODE` | `read-only`, `workspace-write`, `danger-full-access` |
| `--full-auto` | Otomatik onay + sandbox |
| `--dangerously-bypass-approvals-and-sandbox` | Tüm güvenlik bypass (TEHLİKELİ) |

---

## 2. Config Yapısı

### Konum

```
~/.codex/config.toml
```

### Örnek Config

```toml
model = "gpt-5.2-codex"
model_reasoning_effort = "medium"

[projects."/home/fekrat"]
trust_level = "trusted"

[features]
unified_exec = true
shell_snapshot = true

[mcp_servers.helm]
command = "bun"
args = ["run", "/path/to/server.ts"]

[notice]
hide_full_access_warning = true
```

### Dizin Yapısı

```
~/.codex/
├── auth.json           # Authentication bilgileri
├── config.toml         # Ana config
├── history.jsonl       # Komut geçmişi
├── models_cache.json   # Model cache
├── sessions/           # Session kayıtları
│   └── 2026/01/29/     # Tarih bazlı
│       └── rollout-*.jsonl
├── shell_snapshots/    # Shell snapshot'ları
├── skills/             # Custom skills
└── tmp/
```

---

## 3. Session Yapısı

### Konum

```
~/.codex/sessions/{YEAR}/{MONTH}/{DAY}/rollout-{TIMESTAMP}-{UUID}.jsonl
```

### JSONL Formatı

Her satır bir JSON objesi (JSONL streaming):

#### session_meta

```json
{
  "timestamp": "2026-01-29T16:29:07.232Z",
  "type": "session_meta",
  "payload": {
    "id": "019c0a96-491a-71c0-8edd-f9cd14b1aa4d",
    "cwd": "/path/to/project",
    "cli_version": "0.92.0",
    "model_provider": "openai",
    "git": {
      "commit_hash": "...",
      "branch": "main",
      "repository_url": "..."
    }
  }
}
```

#### response_item (mesajlar)

```json
{
  "timestamp": "...",
  "type": "response_item",
  "payload": {
    "type": "message",
    "role": "user",  // veya "developer", "assistant"
    "content": [
      { "type": "input_text", "text": "..." }
    ]
  }
}
```

---

## 4. Non-Interactive Mode (exec)

### Temel Kullanım

```bash
codex exec "prompt"
codex exec --json "prompt"
codex exec -o output.txt "prompt"
```

### JSONL Output Formatı

```json
{"type":"thread.started","thread_id":"..."}
{"type":"turn.started"}
{"type":"response.output_item.added","item":{...}}
{"type":"response.output_item.done","item":{...}}
{"type":"turn.completed"}
{"type":"thread.completed"}
```

### Hata Durumu

```json
{"type":"error","message":"..."}
{"type":"turn.failed","error":{"message":"..."}}
```

---

## 5. MCP Server Desteği

Codex hem MCP client hem MCP server olarak çalışabilir!

### MCP Client (config.toml)

```toml
[mcp_servers.my_server]
command = "node"
args = ["server.js"]
```

### MCP Server Olarak Çalıştırma

```bash
codex mcp-server  # stdio transport ile MCP server
```

---

## 6. Sandbox Modları

| Mod | Açıklama |
|-----|----------|
| `read-only` | Sadece okuma, yazma yok |
| `workspace-write` | Workspace içinde yazma |
| `danger-full-access` | Tam erişim (tehlikeli) |

---

## 7. Approval Politikaları

| Politika | Açıklama |
|----------|----------|
| `untrusted` | Sadece trusted komutlar (ls, cat, sed) |
| `on-failure` | Hata olursa onay iste |
| `on-request` | Model karar verir |
| `never` | Asla onay isteme (non-interactive) |

---

## 8. Gemini vs Codex Karşılaştırması

| Özellik | Gemini CLI | Codex CLI |
|---------|------------|-----------|
| Output Format | JSON (tek obje) | JSONL (streaming) |
| Session Dosyası | `~/.gemini/tmp/{hash}/chats/*.json` | `~/.codex/sessions/{date}/*.jsonl` |
| Config Format | JSON | TOML |
| MCP Server | Sadece client | Client + Server |
| Non-interactive | `-p "prompt"` | `exec "prompt"` |
| Slash Commands | `/help`, `/stats` | `/model`, `/approve` |
| Trust System | Folder trust | Project trust levels |

---

## 9. Test Notları

### Token Expired Sorunu

```
Your refresh token has already been used to generate a new access token.
Please try signing in again.
```

**Çözüm:**
```bash
codex logout
codex login
```

---

## 10. Proposed Architecture (Codex için)

### Non-Interactive Mode

```typescript
async function runCodexNonInteractive(prompt: string, workDir: string) {
  const result = execSync(
    `cd "${workDir}" && codex exec --json --skip-git-repo-check "${escapePrompt(prompt)}"`,
    { encoding: 'utf-8' }
  )

  // JSONL parse
  const lines = result.trim().split('\n')
  const events = lines.map(line => JSON.parse(line))

  // Son mesajı bul
  const completed = events.find(e => e.type === 'turn.completed')
  return completed?.output || null
}
```

### Interactive Mode (tmux)

```bash
# Session başlat
tmux new-session -d -s codex_session -c /project/path

# Codex başlat
tmux send-keys -t codex_session 'codex' Enter

# Prompt gönder
tmux set-buffer -b p "Soru: prompt içeriği"
tmux paste-buffer -t codex_session -b p
tmux send-keys -t codex_session Enter

# Session dosyasını izle
# ~/.codex/sessions/{date}/*.jsonl
```

---

## 11. tmux Test Sonuçları (2026-01-30)

### Çalışan Komutlar

```bash
# Session başlat
tmux new-session -d -s codex_session -c /project/path

# Codex başlat
tmux send-keys -t codex_session 'codex' Enter

# İlk çalıştırmada onay gerekebilir (git repo değilse)
# Seçenek 1: Allow without approval
tmux send-keys -t codex_session Up Enter

# Prompt gönder
tmux send-keys -t codex_session 'soru burada' Enter

# Output al
tmux capture-pane -t codex_session -p

# Session kapat
tmux send-keys -t codex_session C-c
tmux kill-session -t codex_session
```

### Slash Command Davranışı - Gemini'den FARKLI!

| Input | Codex | Gemini |
|-------|-------|--------|
| `/model komutu ne yapar?` | ✅ Normal prompt | ❌ Slash command |
| `/model` (tek başına) | ⚠️ Slash command (model picker) | ❌ Slash command |

**Codex'te slash command tetiklenmesi:** Sadece `/komut` tek başına yazılırsa.
**Gemini'de:** `/` ile başlayan her şey slash command.

**Sonuç:** Codex'te "Soru:" prefix'ine gerek yok!

### Session Dosyası Yapısı

**Konum:** `~/.codex/sessions/2026/01/30/rollout-{timestamp}-{uuid}.jsonl`

**Önemli Event Türleri:**

```json
// Agent cevabı
{"type":"event_msg","payload":{"type":"agent_message","message":"cevap metni"}}

// Yapılandırılmış mesaj
{"type":"response_item","payload":{
  "type":"message",
  "role":"assistant",
  "content":[{"type":"output_text","text":"cevap"}]
}}

// Token kullanımı
{"type":"event_msg","payload":{
  "type":"token_count",
  "info":{
    "total_token_usage":{"input_tokens":9047,"output_tokens":28},
    "model_context_window":258400
  }
}}
```

### Parse Stratejisi

```typescript
// JSONL dosyasını oku
const lines = fs.readFileSync(sessionFile, 'utf-8').trim().split('\n')
const events = lines.map(line => JSON.parse(line))

// Son agent mesajını bul
const lastMessage = events
  .filter(e => e.type === 'event_msg' && e.payload?.type === 'agent_message')
  .pop()

return lastMessage?.payload?.message
```

### Session Watcher

```typescript
// Codex session dosyaları tarih bazlı
const today = new Date()
const sessionDir = path.join(
  os.homedir(),
  '.codex/sessions',
  today.getFullYear().toString(),
  String(today.getMonth() + 1).padStart(2, '0'),
  String(today.getDate()).padStart(2, '0')
)

// En son rollout dosyasını bul
const files = fs.readdirSync(sessionDir)
  .filter(f => f.startsWith('rollout-'))
  .sort()
  .reverse()

const latestSession = path.join(sessionDir, files[0])
```

---

## 12. Gemini vs Codex Karşılaştırması (Güncellenmiş)

| Özellik | Gemini CLI | Codex CLI |
|---------|------------|-----------|
| **Slash Command Tetikleme** | `/` ile başlayan HER ŞEY | Sadece `/komut` (tek başına) |
| **Safe Prefix Gerekli?** | EVET (`Soru: `) | HAYIR |
| **Enter Key** | `Enter` veya `C-m` | `Enter` |
| **Session Konum** | `~/.gemini/tmp/{hash}/chats/*.json` | `~/.codex/sessions/{date}/*.jsonl` |
| **Session Format** | Tek JSON dosyası | JSONL streaming |
| **Cevap Marker** | `◆END◆` | Yok (event_msg type ile algıla) |
| **Parse Yöntemi** | JSON + regex | JSONL filter |

---

## 13. Referanslar

- [Codex CLI Docs](https://developers.openai.com/codex/cli/)
- [Codex CLI Features](https://developers.openai.com/codex/cli/features/)
- [Codex CLI Reference](https://developers.openai.com/codex/cli/reference/)
- [GitHub - openai/codex](https://github.com/openai/codex)
- [Slash Commands](https://developers.openai.com/codex/cli/slash-commands/)
