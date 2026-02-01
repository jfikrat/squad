# Squad MCP - Project Overview

## Problem

Claude Code güçlü bir AI asistan, ancak tek başına çalışıyor. Bazı durumlarda:
- Farklı bir perspektif gerekiyor (second opinion)
- Daha derin teknik analiz lazım (Codex'in reasoning gücü)
- Hızlı kod üretimi gerekiyor (Gemini'nin hızı)
- Paralel araştırma yapmak istiyorsun

## Çözüm

**Squad MCP** - Claude Code'a Codex ve Gemini'yi entegre eden bir MCP server.

```
┌─────────────────┐
│   Claude Code   │
│   (Ana Agent)   │
└────────┬────────┘
         │ MCP Protocol
         ▼
┌─────────────────┐
│   Squad MCP     │
│    Server       │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────┐
│ Codex │ │Gemini │
│  CLI  │ │  CLI  │
└───────┘ └───────┘
```

## Nasıl Çalışır?

1. **Claude Code** bir soru sorar (MCP tool call)
2. **Squad MCP** ilgili agent'ı başlatır (tmux session)
3. **Codex/Gemini** soruyu cevaplar
4. **Squad MCP** cevabı parse edip Claude Code'a döner
5. **Claude Code** cevabı kullanır

### Neden tmux?

- **Görünürlük**: Agent'ların ne yaptığını görebilirsin
- **Debug**: Sorun olursa terminale bakabilirsin
- **Multi-turn**: Aynı session'da devam eden konuşma
- **State**: Session crash olsa bile state korunur

## Tools

### codex
```typescript
codex({
  message: "Bu kodu analiz et, bug var mı?",
  workDir: "/home/user/project",
  reasoning_effort: "xhigh"  // xhigh | high | medium | low
})
```

**Ne zaman kullan:**
- Derin teknik analiz
- Karmaşık bug debugging
- Mimari review
- Code review

### gemini
```typescript
gemini({
  message: "Bu component için UI tasarla",
  workDir: "/home/user/project",
  model: "flash"  // flash | pro
})
```

**Ne zaman kullan:**
- Hızlı kod üretimi
- UI/UX önerileri
- Yaratıcı çözümler
- Basit sorular

### parallel_search
```typescript
parallel_search({
  queries: [
    "React hooks best practices",
    "TypeScript generics patterns",
    "Node.js performance tips",
    "PostgreSQL indexing strategies"
  ],
  workDir: "/home/user/project"
})
```

**Ne zaman kullan:**
- Araştırma yapılacaksa
- Farklı konularda bilgi gerekiyorsa
- Karşılaştırmalı analiz

## Use Cases

### 1. Second Opinion
```
Claude: "Bu mimariyi nasıl yapmalıyım?"
→ codex(xhigh) ile derin analiz al
→ Farklı perspektif ve öneriler
```

### 2. Parallel Research
```
Claude: "Modern auth yöntemlerini araştır"
→ parallel_search ile 4 farklı soru
→ OAuth, JWT, Passkeys, Session-based
→ Hepsinin cevabı paralel gelir
```

### 3. Code Generation
```
Claude: "Bu component'i hızlıca yaz"
→ gemini(flash) ile hızlı kod üretimi
→ Claude review eder ve düzenler
```

### 4. Complex Debugging
```
Claude: "Bu race condition'ı bulamıyorum"
→ codex(xhigh) ile derin analiz
→ Codex potansiyel yerleri işaret eder
→ Claude fix'i uygular
```

## Avantajlar

| Özellik | Açıklama |
|---------|----------|
| **Multi-AI** | Tek AI'a bağımlı kalma, farklı perspektifler al |
| **Specialized** | Her AI kendi güçlü yanında kullanılır |
| **Parallel** | 4 sorgu aynı anda çalışabilir |
| **Visible** | tmux ile agent'ları görebilirsin |
| **Persistent** | Session'lar arası context korunur |

## Teknik Detaylar

### Session Management
- Her agent kendi tmux session'ında çalışır
- Her MCP instance unique 4-karakterlik ID alır (örn: `a7x2`)
- Session isimleri: `agents_{instanceId}_{agent}` (örn: `agents_a7x2_codex_xhigh`)
- Bu sayede farklı Claude Code instance'ları birbirinin session'larına karışmaz
- 60 dakika timeout (uzun analizler için)
- Terminal kapatılırsa session da kapanır

### Request/Response Matching
- Her request'e unique ID atanır: `[RQ-abc123]`
- Agent yanıtın sonuna marker koyar: `[ANS-abc123]`
- Session dosyası parse edilerek doğru yanıt bulunur

### Error Handling
- Session terminated: Kullanıcı terminali kapattı
- Timeout: Agent belirlenen sürede cevap vermedi
- Parse error: Yanıt formatı beklenenden farklı

## Sınırlamalar

1. **Local only**: Agent CLI'ları local'de kurulu olmalı
2. **Terminal gerekli**: Görünür tmux session için terminal lazım
3. **API anahtarları**: Codex ve Gemini için auth gerekli

## Gelecek Planlar

- [ ] MCP tool passthrough (agent tool'larını Claude'a sun)
- [ ] Claude API entegrasyonu (3. agent olarak)
- [ ] Session persistence (restart sonrası devam)
- [ ] Web UI (terminal yerine browser)
