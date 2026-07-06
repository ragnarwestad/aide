# AI Dev Tools — Nyhetslogg

Levende changelog for de fire AI-dev-verktøyene doc-aide støtter:
Claude Code, GitHub Copilot CLI, OpenAI Codex CLI og Gemini CLI.

Loggen er research-feeden som driver kontinuerlig forbedring av doc-aide.
Den destilleres videre inn i to dokumenter:

- [AI_SUPPORT_MATRIX.md](./AI_SUPPORT_MATRIX.md) — destillert nåtilstand (versjoner, mekanismer, oppfølgingspunkter)
- [`.claude/rules/ai-tools-reference.md`](../.claude/rules/ai-tools-reference.md) — verifisert config-referanse som lastes inn i AI-kontekst

## Innholdsfortegnelse

- [Vedlikehold](#vedlikehold)
  - [Kilder](#kilder)
- [Notasjon](#notasjon)
- [Nyhetslogg](#nyhetslogg)
  - [2026-05-23](#2026-05-23)
  - [2026-05-14](#2026-05-14)
  - [2026-03-28](#2026-03-28)
  - [2026-03-15](#2026-03-15)
  - [2026-02-28](#2026-02-28)
  - [2026-02-20](#2026-02-20)
  - [2026-02-14](#2026-02-14)
  - [2026-02-06](#2026-02-06)
  - [2026-01-05](#2026-01-05)
  - [2025-11-29](#2025-11-29)

---

## Vedlikehold

Kjør `/check-news`-skillen for å oppdatere loggen. Den henter changelogs fra
kildene under, vurderer relevans for doc-aide, legger til en ny datert
seksjon øverst i [Nyhetslogg](#nyhetslogg), og **flagger forslag** til endringer
i `AI_SUPPORT_MATRIX.md` og `ai-tools-reference.md` som du godkjenner før de
skrives.

Skillen lever i `.claude/skills/check-news/SKILL.md` — den er repo-lokal og kjører
kun når du jobber i doc-aide.

### Kilder

Kanoniske changelog-kilder skillen henter fra (siden forrige gjennomgang):

| Verktøy | Kilder |
|---------|--------|
| Claude Code | <https://github.com/anthropics/claude-code/releases> · <https://www.anthropic.com/news> |
| GitHub Copilot CLI | <https://github.blog/changelog/label/copilot/> · <https://github.com/github/copilot-cli/releases> |
| OpenAI Codex CLI | <https://github.com/openai/codex/releases> · <https://developers.openai.com/codex/changelog/> |
| Gemini CLI | <https://geminicli.com/docs/changelogs/> · <https://github.com/google-gemini/gemini-cli/releases> |

---

## Notasjon

Relevansmerking i hver gjennomgangs `Relevans for doc-aide`-seksjon:

| Symbol | Betydning |
|--------|-----------|
| ⭐ | Direkte påvirkning på doc-aide (krever handling) |
| ✅ | Nyttig, men ingen umiddelbar handling |
| ℹ️ | Informativt, lav relevans |
| ⚠️ | Breaking change eller noe som må verifiseres |

---

## Nyhetslogg

### 2026-05-23

Kort periode (14.–23. mai, ~9 dager). Rolig etter modell-bølgen i forrige periode — mest inkrementelle CLI-releaser. 
Hovedfunn: **Claude Code døpte om `/simplify` til `/code-review`**, og **Gemini 3.5 Flash ble GA**.

**Claude Code (14.–23. mai, v2.1.142 → v2.1.150):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| May 14 | v2.1.142 | **Fast mode defaulter nå til Opus 4.7** (var 4.6). Plugins med rot-`SKILL.md` vises som skills. Nye `claude agents`-flagg (`--add-dir`, `--settings`, `--model`, `--effort` m.fl.) | [Changelog](https://code.claude.com/docs/en/changelog) |
| May 15 | v2.1.143 | Plugin dependency enforcement (`disable` nekter når andre plugins avhenger), `worktree.bgIsolation: "none"`, PowerShell `-ExecutionPolicy Bypass` som default | [Changelog](https://code.claude.com/docs/en/changelog) |
| May 19 | v2.1.144–145 | `claude agents --json` for scripting, `agent_id`/`parent_agent_id` i OTEL-spans, `/plugin` Discover/Browse viser commands/agents/skills/hooks/MCP/LSP, `/resume` for bakgrunnssesjoner, `/model` endrer kun gjeldende sesjon | [Changelog](https://code.claude.com/docs/en/changelog) |
| May 21 | v2.1.146–147 | **`/simplify` døpt om til `/code-review`** med valgfrie effort-nivåer (`/code-review high`). Pinnede bakgrunnssesjoner holdes i live når idle | [Changelog](https://code.claude.com/docs/en/changelog) |
| May 22 | v2.1.149 | `/usage` med per-kategori-fordeling (skills/subagents/plugins/MCP), GFM task-list-checkboxes i markdown, `allowAllClaudeAiMcps` managed setting, flere sikkerhetsfikser | [Changelog](https://code.claude.com/docs/en/changelog) |

**GitHub Copilot CLI (14.–23. mai, v1.0.48 → v1.0.51):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| May 18 | v1.0.49 | **`/rubber-duck`** for uavhengig kritikk, **`/memory`**-kommando for persistent minne, Alpine Linux-støtte | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| May 20 | v1.0.51 | **`/security-review`** for sårbarhetsvurdering, session resumption med `--session-id`, tilpassbar status line, `/chronicle cost-tips` | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| May 21–23 | v1.0.52-x (pre) | Deferred tool loading for custom agents, `/compact` med fokus-instruksjoner, vertikal scrollbar med musedrag | [GitHub Releases](https://github.com/github/copilot-cli/releases) |

**GitHub Copilot Platform (14.–21. mai):**

| Dato | Nyhet | Kilde |
|------|-------|-------|
| May 14 | **GitHub Copilot-app i technical preview**, team-level usage metrics via API | [GitHub Blog](https://github.blog/changelog/label/copilot/) |
| May 17 | **GPT-5.3-Codex base-modell for Copilot Business/Enterprise** | [GitHub Blog](https://github.blog/changelog/label/copilot/) |
| May 18 | Copilot cloud agent (raske/billige modeller), **Remote control av CLI-sesjoner GA** (mobil/web/VS Code), Copilot Spaces API GA | [GitHub Blog](https://github.blog/changelog/label/copilot/) |
| May 19 | **Gemini 3.5 Flash GA for Copilot**, code review-feedback kan anvendes via cloud agent | [GitHub Blog](https://github.blog/changelog/label/copilot/) |
| May 21 | Copilot for Eclipse open source | [GitHub Blog](https://github.blog/changelog/label/copilot/) |

**OpenAI Codex CLI (18.–21. mai, v0.131 → v0.133):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| May 18 | v0.131.0 | Unified `@`-mentions (filer/kataloger/plugins/skills), plugin marketplace CLI med version-aware sharing, **`codex doctor`** diagnostikk, Python SDK → `openai-codex` | [GitHub](https://github.com/openai/codex/releases) |
| May 20 | v0.132.0 | Python SDK first-class auth (API key / ChatGPT / device-code), `codex exec resume --output-schema` for strukturert output | [GitHub](https://github.com/openai/codex/releases) |
| May 21 | v0.133.0 | **Goals aktivert som default** med egen lagring + progresjon, permission profiles med list-API og arv | [GitHub](https://github.com/openai/codex/releases) |

Plattform: **Codex-app 26.519** (21. mai) — Appshots (send frontmost app-vindu til Codex), Goal mode GA på tvers av app/IDE/CLI, remote computer use.

**Gemini CLI (14.–22. mai, v0.42.0 → v0.43.0):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| May 17 | nightly | Gemini 3.1 model aliases, sikkerhetsoppdateringer | [GitHub](https://github.com/google-gemini/gemini-cli/releases) |
| May 22 | v0.43.0 | **Surgical code edits** — modellen styres mot `edit`-tool for presise endringer (raskere/mer presist), session export/import, adaptiv token-estimering | [Gemini CLI](https://geminicli.com/docs/changelogs/) |

**Nye modeller:**

| Dato | Modell | Detaljer | Kilde |
|------|--------|----------|-------|
| May 19 | **Gemini 3.5 Flash** | GA for GitHub Copilot | [GitHub Blog](https://github.blog/changelog/label/copilot/) |
| May 14 | **Opus 4.7 (Fast mode)** | Fast mode i Claude Code defaulter nå til Opus 4.7 (var 4.6) | [Changelog](https://code.claude.com/docs/en/changelog) |

**Relevans for doc-aide:**

- ⚠️ **`/simplify` døpt om til `/code-review` (Claude Code v2.1.147)** — `core/rules/llm-discipline.md:57` (og den genererte `implementations/copilot/AGENTS.md:537`) viser til «`/simplify`-skillen» for «Enkelhet først». Referansen til den innebygde skillen er nå utdatert. Bør verifiseres mot lokal Claude Code-versjon og oppdateres
- ⭐ **Plugins med rot-`SKILL.md` vises som skills (Claude Code v2.1.142) + unified `@`-mentions for skills (Codex v0.131)** — flere verktøy gjør skill-distribusjon enklere; relevant for hvordan doc-aide pakkes og distribueres
- ⭐ **`/security-review` (Copilot v1.0.51) + `/code-review` (Claude Code)** — begge verktøy har nå innebygd review-kommando; supplerer `/ultrareview` fra forrige periode. Kan brukes på prosjektene
- ✅ **`/memory` i Copilot CLI + Copilot Memory for Pro/Pro+** — minne-konvergensen fortsetter; alle verktøy modner persistent memory
- ✅ **Goals default i Codex (v0.133) + `/goal` i Claude Code** — `/goal`-primitiven modnes i begge verktøy
- ✅ **`claude agents --json` (v2.1.145)** — scripting-vennlig agent-kjøring, relevant hvis doc-aide automatiserer agent-workflows
- ✅ **Fast mode → Opus 4.7 (Claude Code v2.1.142)** — Fast-bruk i doc-aide treffer nå Opus 4.7
- ℹ️ **Codex Appshots/computer use, Copilot for Eclipse, Gemini surgical edits** — produkt-/UX-utvidelser, lav prioritet for doc-aide

---

### 2026-05-14

Stor periode (28. mars – 14. mai, ~7 uker). Alle fire CLI-verktøy hadde høy releasefrekvens. Hovednyhet: **tre nye frontier-modeller** — Claude Opus 4.7, GPT-5.5 og Gemini 3 Flash — lansert i løpet av perioden.

**Claude Code (28. mars – 13. mai, v2.1.86 → v2.1.141, ~55 releaser):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Mar 31–Apr 2 | v2.1.89–91 | `defer`-permission for hooks, `PermissionDenied` hook-event, `/powerup` interaktive lessons, per-tool MCP result-size override | [Changelog](https://code.claude.com/docs/en/changelog) |
| Apr 9–10 | v2.1.98–101 | **Monitor-tool** for streaming av bakgrunns-events, subprocess-sandboxing med PID-namespace (Linux), Vertex AI setup-wizard | [Changelog](https://code.claude.com/docs/en/changelog) |
| Apr 13 | v2.1.105 | **PreCompact-hook** med blokkeringsevne, `/proactive` alias for `/loop`, `path`-parameter til `EnterWorktree` | [Changelog](https://code.claude.com/docs/en/changelog) |
| Apr 14 | v2.1.108 | `ENABLE_PROMPT_CACHING_1H` (1-times cache-TTL), recap-feature for session-kontekst, `/undo` alias for `/rewind` | [Changelog](https://code.claude.com/docs/en/changelog) |
| Apr 15 | v2.1.110 | `/tui`-kommando (flicker-fri fullscreen), push notification-tool for mobil-varsler, `/focus`-kommando | [Changelog](https://code.claude.com/docs/en/changelog) |
| Apr 16 | v2.1.111 | **Claude Opus 4.7** i Claude Code — nytt `xhigh` effort-nivå, `/effort` interaktiv slider, Auto mode på Opus 4.7 for Max. Ny **`/ultrareview`** for skybasert kodegjennomgang | [Changelog](https://code.claude.com/docs/en/changelog) |
| Apr 17 | v2.1.113 | **Native binary-arkitektur** — CLI spawner native Claude Code-binary i stedet for bundlet JavaScript | [Changelog](https://code.claude.com/docs/en/changelog) |
| Apr 23 | v2.1.118–119 | **Vim visual mode**, `/usage` (slått sammen `/cost`+`/stats`), custom themes, hooks kan kalle MCP-tools direkte (`type: "mcp_tool"`) | [Changelog](https://code.claude.com/docs/en/changelog) |
| Apr 28 | v2.1.120 | **Windows uten Git Bash** — PowerShell brukes som shell-tool når Bash mangler. `claude ultrareview [target]` ikke-interaktiv subkommando for CI | [Changelog](https://code.claude.com/docs/en/changelog) |
| May 4–8 | v2.1.128–136 | **Plugins fra `.zip`-arkiver og URLer** (`--plugin-url`), `worktree.baseRef`, auto mode hard deny-regler, hooks ser `effort.level` | [Changelog](https://code.claude.com/docs/en/changelog) |
| May 11 | v2.1.139 | **Agent View (research preview)** — `claude agents`-kommando, **`/goal`-kommando** med completion-conditions og live overlay | [Changelog](https://code.claude.com/docs/en/changelog) |

Plattform: **Routines på Claude Code on the web** (templatede sky-agenter trigget av schedule/GitHub-event/API), **mobile push notifications**, **Claude Design** (research preview — prototyper/slides/mockups), **Computer use** kommer til CLI (research preview), **Advisor-tool** (Sonnet/Haiku konsulterer Opus på vanskelige beslutninger).

**GitHub Copilot CLI (30. mars – 14. mai, v1.0.13 → v1.0.48):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Apr 4 | v1.0.18 | **Critic-agent** — gjennomgår automatisk planer med en komplementær modell | [Changelog](https://github.com/github/copilot-cli/blob/main/changelog.md) |
| Apr 13 | v1.0.25 | **Remote control av CLI-sesjoner** (`--remote`/`/remote`), MCP-installasjon fra registry, `/env`-kommando | [Changelog](https://github.com/github/copilot-cli/blob/main/changelog.md) |
| Apr 16 | v1.0.29 | **Claude Opus 4.7-støtte** | [Changelog](https://github.com/github/copilot-cli/blob/main/changelog.md) |
| Apr 17 | v1.0.32 | **`auto` som modell** — Copilot velger automatisk beste modell. Advarsler ved 75 %/90 % av ukentlig bruksgrense | [Changelog](https://github.com/github/copilot-cli/blob/main/changelog.md) |
| Apr 23 | v1.0.35 | HTTP-hook-støtte (POST JSON), navngitte sesjoner, tab-completion for slash-argumenter, brukerinnstillinger → `~/.copilot/settings.json` | [Changelog](https://github.com/github/copilot-cli/blob/main/changelog.md) |
| May 1 | v1.0.40 | **`/research`** orkestrator/subagent-modus, `/chronicle`-kommando + sesjonshistorikk, skills som slash-kommandoer i ACP | [Changelog](https://github.com/github/copilot-cli/blob/main/changelog.md) |
| May 11 | v1.0.45 | **`/autopilot`** og **`/fork`**-slash-kommandoer, PowerShell 7+-fallback på Windows | [Changelog](https://github.com/github/copilot-cli/blob/main/changelog.md) |

Plattform: **Copilot CLI støtter BYOK og lokale modeller** (Ollama, vLLM, Foundry Local; `COPILOT_OFFLINE=true` for air-gapped bruk, 7. apr). **Copilot SDK** i public preview (2. apr). **`gh skill`-kommando** i GitHub CLI — portable skills på tvers av Copilot/Claude Code/Cursor (16. apr). **Enterprise-managed plugins** i public preview — admins distribuerer plugins til hele org via `.github-private`-repo (6. mai). **Rubber-duck-agent** — Claude reviewer GPT-sesjoner, GPT-5.5 reviewer Claude-sesjoner.

**OpenAI Codex CLI (31. mars – 8. mai, v0.117 → v0.130):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Apr 15 | v0.121.0 | **Memory mode-kontroller + memory reset/sletting**, `codex marketplace add`, TUI prompt-historikk med `Ctrl+R` | [GitHub](https://github.com/openai/codex/releases) |
| Apr 20 | v0.122.0 | **Plan Mode kan starte implementering i fersk kontekst**, plugin tabbed browsing, `codex app` for Desktop | [GitHub](https://github.com/openai/codex/releases) |
| Apr 23 | v0.124.0 | **Hooks nå stabile** (inline config, observerer MCP/apply_patch/Bash), first-class Amazon Bedrock-støtte | [GitHub](https://github.com/openai/codex/releases) |
| Apr 30 | v0.128.0 | **Persisterte `/goal`-workflows**, **`codex update`-kommando**, `--full-auto` deprecated → permission profiles | [GitHub](https://github.com/openai/codex/releases) |
| May 7–8 | v0.129–130 | **Modal Vim-redigering** (`/vim`), **`/hooks`-browser**, **`codex remote-control`** headless app-server | [GitHub](https://github.com/openai/codex/releases) |

Plattform: **Codex-appen "Codex for (almost) everything"** — background computer use på macOS, in-app browser, 90+ plugins, PR-review i appen (16. apr — computer use ikke tilgjengelig i EU/EØS). **Codex for Chrome** — Chrome-extension som jobber på tvers av faner i bakgrunnen (7. mai). **Automatic approval reviews** — reviewer-agent før kjøring.

**Gemini CLI (1. april – 12. mai, v0.35.3 → v0.42.0):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Apr 1 | v0.36.0 | **Git worktree-støtte** for parallelle sesjoner, native macOS Seatbelt + Windows sandboxing, multi-registry subagent-sikkerhet | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| Apr 14 | v0.38.1 | **Subagents offisielt lansert** — task-delegering, isolerte kontekstvinduer, innebygde eksperter (@codebase_investigator m.fl.) | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| Apr 23 | v0.39.0 | **`/memory inbox`** for review/patching av skills, Plan Mode krever bekreftelse for skill-aktivering | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| Apr 28 | v0.40.0 | Bundlet ripgrep for offline-søk, MCP resource tools, fire-lags memory management-system | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| May 5 | v0.41.0 | **Sanntids voice mode** med sky- og lokal-backend, håndhevet workspace trust | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| May 12 | v0.42.0 | Auto Memory Inbox med canonical-patch-kontrakt, Gemma 4 default via Gemini API, session export/import | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |

**Nye modeller — oversikt:**

| Dato | Modell | Detaljer | Kilde |
|------|--------|----------|-------|
| Apr 16 | **Claude Opus 4.7** | Anthropics mest kapable GA-modell. 1M context, 128k output, ~13 % løft på coding-benchmarks. **Breaking changes:** extended thinking budgets fjernet, sampling-parametere (`temperature`/`top_p`/`top_k`) gir nå 400-feil, ny tokenizer (~1–1.35x token-bruk). Pris uendret ($5/$25 per M) | [Anthropic](https://www.anthropic.com/news/claude-opus-4-7) |
| ~Apr 16 | **GPT-5.4 mini** | Rask/effektiv modell i Codex for lettere oppgaver og subagenter (>2x raskere enn GPT-5 mini) | [OpenAI](https://developers.openai.com/codex/changelog) |
| Apr 22 | **Gemini 3 Flash** | "Frontier intelligence built for speed at a fraction of the cost" — preview via Gemini API | [Google](https://blog.google/products/gemini/gemini-3-flash/) |
| Apr 23 | **GPT-5.5** | OpenAIs nye frontier-modell — lansert i API, ChatGPT og Codex samme dag. GPT-5.5 Pro også. Anbefalt default i Codex | [OpenAI](https://openai.com/index/introducing-gpt-5-5/) |
| May 7 | **Gemini 3.1 Flash-Lite** | GA — raskeste og mest kostnadseffektive Gemini 3-modell | [Google Cloud](https://cloud.google.com/blog/products/ai-machine-learning/gemini-3-1-flash-lite-is-now-generally-available) |

**Relevans for doc-aide:**

- ⚠️ **Opus 4.7 breaking changes** — sampling-parametere (`temperature` m.fl.) gir nå 400-feil, extended thinking budgets fjernet. Sjekk om `aide-*`-scripts eller SDK-kall setter disse. Ny tokenizer betyr ~1–1.35x token-bruk
- ⭐ **Opus 4.7 + `xhigh` effort** — ny default-modell på Max. `effort`-frontmatter (fra mars) kan nå sette `xhigh` for tunge analyse-skills
- ⭐ **`/ultrareview` (Claude Code) + Codex automatic reviews + Copilot Critic-agent** — alle tre verktøy har nå skybasert/automatisk kodegjennomgang. Kan brukes på prosjektene
- ⭐ **`/goal`-kommando i både Claude Code og Codex** — ny workflow-primitiv med completion-conditions. Vurder for langkjørende doc-aide-oppgaver (migrasjoner, todo-planer)
- ⭐ **`gh skill`-kommando** — portable skills på tvers av Copilot/Claude Code/Cursor med versjonspinning og supply chain-sikkerhet. Direkte relevant for hvordan doc-aide distribuerer skills
- ⭐ **Enterprise-managed plugins (Copilot)** — admins kan distribuere plugins (agents, skills, hooks, MCP) til hele org via `.github-private`-repo. Mulig distribusjonsmodell for doc-aide i større organisasjoner
- ⭐ **Plugins fra `.zip`/URL (Claude Code v2.1.128+)** — enklere distribusjon av doc-aide som plugin uten marketplace
- ⭐ **Subagents i Gemini CLI** — nå har alle fire verktøy subagents med isolerte kontekstvinduer
- ✅ **HTTP-hooks + `defer`/conditional hooks + `type: "mcp_tool"` (Claude Code)** — mer kraftfull hook-konfigurasjon for doc-aide install.sh/settings.json
- ✅ **Codex hooks nå stabile** — alle fire verktøy har nå stabile hooks
- ✅ **Windows PowerShell uten Git Bash (Claude Code) + PowerShell 7+-fallback (Copilot)** — bedre Windows-støtte
- ✅ **BYOK + lokale modeller + `COPILOT_OFFLINE` (Copilot CLI)** — air-gapped bruk, potensielt relevant ved strenge sikkerhetskrav
- ✅ **Native binary-arkitektur (Claude Code v2.1.113)** — raskere oppstart, lavere minnebruk
- ✅ **Memory-konvergens** — Claude Code recap, Codex memory reset, Gemini Auto Memory Inbox — alle verktøy modner persistent memory
- ℹ️ **Claude Design, Codex for Chrome, Gemini voice mode** — produkt-utvidelser, lav prioritet for doc-aide

---

### 2026-03-28

**Claude Code (mars 17-27, 10 releaser: v2.1.78 → v2.1.86):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Mar 27 | v2.1.86 | **Session-ID header** — `X-Claude-Code-Session-Id` for proxy session-aggregering. Skill descriptions capped 250 tegn i `/skills`. VSCode fix: "Not responding" under lang-kjørende operasjoner | [Changelog](https://code.claude.com/docs/en/changelog) |
| Mar 26 | v2.1.85 | **Conditional hooks** — `if`-felt for hooks bruker permission rule syntax. PreToolUse hooks kan svare på AskUserQuestion. MCP OAuth RFC 9728 discovery. Deep links opp til 5000 tegn | [Changelog](https://code.claude.com/docs/en/changelog) |
| Mar 26 | v2.1.84 | **PowerShell tool (Windows preview)**. `managed-settings.d/` drop-in katalog for policy-fragmenter. `CwdChanged`/`FileChanged` hook events. Transcript-søk med `/`. `initialPrompt` i agent frontmatter. `paths:`-frontmatter aksepterer YAML-lister. Token ≥1M vises som "1.5m" | [Changelog](https://code.claude.com/docs/en/changelog) |
| Mar 25 | v2.1.83 | **Transcript-søk** (`/` i transcript, `n`/`N` for steg). Pasted images som `[Image #N]`-chip. `TaskCreated` hook. `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`. Sandbox `failIfUnavailable`. Plugin `sensitive: true` keychain | [Changelog](https://code.claude.com/docs/en/changelog) |
| Mar 20 | v2.1.81 | **`--bare` flag** for scripted `-p` (skipper hooks/LSP/plugins). **`--channels`** permission relay til mobil. 18MB lavere startup-minne | [Changelog](https://code.claude.com/docs/en/changelog) |
| Mar 19 | v2.1.80 | **Rate limits i statusline** (`used_percentage`, `resets_at`). `effort`-frontmatter for skills. `--channels` research preview for MCP push-meldinger | [Changelog](https://code.claude.com/docs/en/changelog) |
| Mar 18 | v2.1.79 | **`claude auth login --console`**. Turn duration toggle. 18MB lavere startup-minne | [Changelog](https://code.claude.com/docs/en/changelog) |
| Mar 17 | v2.1.78 | **Linje-for-linje streaming**. `StopFailure` hook. `effort`/`maxTurns`/`disallowedTools` frontmatter for plugin agents. Linux sandbox-forbedringer | [Changelog](https://code.claude.com/docs/en/changelog) |

**GitHub Copilot CLI (mars 18-27, v1.0.8 → v1.0.13):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Mar 27 | v1.0.13 | **`/rewind` timeline-picker** — Dobbeltklikk Esc åpner tidslinje for å rulle tilbake til et hvilket som helst punkt. MCP registry retries. V8 compile cache for raskere oppstart | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Mar 23 | v1.0.11 | **Monorepo-støtte** — Skills, instruksjoner, MCP-servere og agents oppdages på hvert katalognivå opp til git-roten. `~/.agents/skills/` som personlig skill-katalog. `/clear` avslutter sesjon, `/new` starter ny (beholder gammel i bakgrunnen). MCP policy-enforcing | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Mar 20 | v1.0.10 | **Concurrent sessions (eksperimentelt)**. `/undo` for å angre siste tur. SDK-klienter kan registrere custom slash commands. `/copy` med HTML-formatering (Windows) | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Mar 18 | v1.0.8 | **Alt-screen default**. Extension mode setting. MCP allowlist via `MCP_ALLOWLIST` feature flag. Hooks i settings.json støttet | [GitHub Releases](https://github.com/github/copilot-cli/releases) |

**GitHub Copilot Platform (mars 23-26):**

| Dato | Nyhet | Kilde |
|------|-------|-------|
| Mar 26 | **@copilot løser merge conflicts på PRer** | [GitHub Blog](https://github.blog/changelog/) |
| Mar 25 | **Copilot for Jira — Public preview** med utvidede funksjoner | [GitHub Blog](https://github.blog/changelog/) |
| Mar 24 | **@copilot gjør endringer direkte på PRer** | [GitHub Blog](https://github.blog/changelog/) |
| Mar 24 | **Copilot coding agent repo-tilgang via API** | [GitHub Blog](https://github.blog/changelog/) |

**OpenAI Codex CLI (mars, v0.117.0):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Mar 26 | v0.117.0 | **Plugins som førsteklasses workflow** — Sync, browse `/plugins`, installer/fjern med auth-håndtering. **Sub-agents med sti-baserte adresser** (`/root/agent_a`) og strukturert inter-agent messaging. `/title` terminal-tittel for parallelle sesjoner. Prompt history i app-server TUI | [GitHub](https://github.com/openai/codex/releases) |

**Gemini CLI (mars 17-28, v0.34.0 → v0.35.3):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Mar 28 | v0.35.3 | Bugfix-release | [GitHub](https://github.com/google-gemini/gemini-cli/releases) |
| Mar 24 | v0.35.0 | **Customizable keyboard shortcuts** med Kitty-protokoll. Vim-mode utvidet (X, ~, r, f/F/t/T, yank/paste). **Tool sandbox** med `SandboxManager` og Linux bubblewrap. JIT context discovery for filsystem-verktøy. `--admin-policy` flag | [GitHub](https://github.com/google-gemini/gemini-cli/releases) |
| Mar 17 | v0.34.0 | **Plan Mode default**. Native gVisor (runsc) og eksperimentell LXC container sandboxing | [Gemini CLI](https://geminicli.com/docs/changelogs/) |

**Relevans for doc-aide:**

- ⭐ **Claude Code conditional hooks (`if`-felt)** — Kan brukes til å lage mer presise hooks i doc-aide, f.eks. kun aktivere ved spesifikke filtyper eller branches. Vurder for install.sh/settings.json
- ⭐ **Claude Code `effort`-frontmatter for skills** — Kan sette reasoning effort per skill. Nyttig for tunge analyse-skills vs raske workflow-skills
- ⭐ **Claude Code `paths:`-frontmatter som YAML-liste** — Enklere sti-spesifikke regler. Oppdater ai-tools-reference.md
- ⭐ **Copilot monorepo-støtte (v1.0.11)** — Skills/instruksjoner oppdages på hvert katalognivå til git-roten. Viktig for monorepo-lignende prosjekter
- ⭐ **Copilot `~/.agents/skills/`** — Ny personlig skill-katalog. Oppdater ai-tools-reference.md sin skill-sti-tabell
- ✅ **Claude Code `--bare` flag** — Nyttig for scripts som kaller Claude programmatisk (aide-* scripts)
- ✅ **Claude Code `CwdChanged`/`FileChanged` hooks** — Reaktiv konfig-håndtering, potensielt nyttig
- ✅ **Claude Code transcript-søk** — Nyttig UX-forbedring for lange sesjoner
- ✅ **Codex plugins + sub-agents** — Codex modnes, men lav prioritet for oss
- ✅ **Gemini tool sandboxing** — Alle fire CLI-verktøy har nå sandboxing
- ℹ️ **Copilot @copilot PR-endringer** — Platform-feature, ikke CLI-relatert

---

### 2026-03-15

**Claude Code (mars 2026):**

| Dato | Nyhet | Kilde |
|------|-------|-------|
| Mar | **Claude Code Security** — Nytt produkt som gjennomgår kodebaser for sikkerhetssårbarheter | [Anthropic](https://www.anthropic.com/news) |
| Mar | **Commands absorbert inn i skills** — `.claude/commands/deploy.md` og `.claude/skills/deploy/SKILL.md` er nå likeverdige og lager begge `/deploy`. Skills er nå det overordnede konseptet. `$ARGUMENTS` støttes i begge. Beskrivelsesbudsjettet skalerer dynamisk til 2% av kontekstvinduet | [Claude Code Docs](https://code.claude.com/docs/en/skills) |
| Jan/Mar | **`/loop` og Cron-verktøy** — Kjør prompts eller slash-commands på gjentakende intervaller innenfor en sesjon | [VentureBeat](https://venturebeat.com/orchestration/claude-code-2-1-0-arrives-with-smoother-workflows-and-smarter-agents) |

**GitHub Copilot CLI (mars 2026):**

| Dato | Nyhet | Kilde |
|------|-------|-------|
| Mar | **`~/.claude/commands/` leses som skills** — Copilot importerer Claude sine slash-command-filer som skills (kilde: `/skills info`). `$ARGUMENTS` ignoreres, instruksjonene leses som naturlig-språk-oppskrift | Oppdaget i praksis |
| Mar | **Cross-session memory** — Copilot husker konvensjoner, mønstre, preferanser og tidligere filer/PRs på tvers av sesjoner | [GitHub Changelog](https://github.blog/changelog/) |
| Mar | **`web_fetch` tool** — Henter URL-innhold som Markdown, allowed/denied URL-mønstre konfigureres i `~/.copilot/config` | [GitHub Docs](https://docs.github.com/en/copilot) |

**Gemini CLI (mars 2026):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Mar 12 | v0.33.1 | **Plan Mode utvidet** — Utvidede kapabiliteter, innebygde research sub-agents, annotasjonsstøtte for mellom-iterasjon-feedback, ny `copy` subcommand, godkjente planer bevares ved chat-komprimering | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| Mar | - | **Generalist agent aktivert** — Forbedret oppgavedelegering og routing, model steering direkte i workspace | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| Mar | - | **UX-forbedringer** — Windows: lim inn bilder med `Alt+V`, automatisk tema-optimalisering basert på terminalfarge, `/logout` for øyeblikkelig credential-clearing, `npx gemini-wrapped` for bruksstatistikk | [Gemini CLI](https://geminicli.com/docs/changelogs/) |

**Relevans for doc-aide:**

- ⭐ **Copilot leser `~/.claude/commands/` som skills** — `~/.claude/commands/` er i praksis en felles distribusjonskilde for Claude og Copilot. Ingen endringer nødvendig i doc-aide — eksisterende kommandoer fungerer i begge verktøy
- ⭐ **Skills/commands unified i Claude Code** — Skillet mellom skills og slash-commands forsvinner gradvis. Enklere mental modell for doc-aide-designet
- ✅ **Claude Code Security** — Nytt verktøy for sikkerhetsgjennomgang av kodebaser — potensielt nyttig for prosjektene
- ✅ **`/loop` og Cron** — Kan brukes til periodiske gjennomganger eller repeterende tasks i doc-aide workflows
- ✅ **Gemini Plan Mode v0.33.1** — Alle fire CLI-verktøy har nå moden plan/analyse-modus

---

### 2026-02-28

**Claude Code (februar 20-28):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Feb 28 | v2.1.63 | **`/simplify` og `/batch` bundled skills** — Nye innebygde slash commands for kodeforenkling og batch-operasjoner | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 28 | v2.1.63 | **HTTP hooks** — POST JSON til URL-er fra hooks, med sandbox-proxy og `allowedEnvVars`-sikring | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 28 | v2.1.63 | **Worktree-delt minne** — Project configs og auto memory deles nå automatisk på tvers av git worktrees | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 26 | v2.1.59 | **Auto-memory forbedret** — Claude lagrer automatisk nyttig kontekst til auto-memory, administreres med `/memory` | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 26 | v2.1.59 | **`/copy` kommando** — Interaktiv picker for å kopiere individuelle kodeblokker eller hele responsen | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 25 | v2.1.53 | **Massiv Windows-stabilitetspush** — Fikset WASM-krasj, ARM64-krasj, panic-feil, EINVAL-feil | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 24 | v2.1.51 | **`claude remote-control`** — Ny subcommand for eksterne builds, custom npm registries, versjonspinning | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 24 | v2.1.51 | **Sikkerhetsforbedringer** — `statusLine`/`fileSuggestion` hooks krever workspace trust, HTTP hooks env vars krever `allowedEnvVars` | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 20-28 | div. | **Minnelekkasje-fiks** — Listener leaks, cache leaks, WebSocket leaks, JSON parsing, git root detection | [GitHub](https://github.com/anthropics/claude-code/releases) |

**GitHub Copilot CLI (februar 20-28):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Feb 25 | v0.0.416 | **🎉 GENERAL AVAILABILITY** — Copilot CLI er nå GA for alle Copilot-abonnenter (Pro, Pro+, Business, Enterprise) | [GitHub Blog](https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/) |
| Feb 26 | - | **Claude + Codex for Business/Pro** — Claude og Codex nå tilgjengelig som coding agents for Copilot Business og Pro (tidligere kun Enterprise/Pro+) | [GitHub Blog](https://github.blog/changelog/2026-02-26-claude-and-codex-now-available-for-copilot-business-pro-users/) |
| Feb 27 | - | **Enterprise CLI-metrics** — Copilot usage metrics inkluderer nå CLI-aktivitet på enterprise-nivå | [GitHub Blog](https://github.blog/changelog/2026-02-27-copilot-usage-metrics-now-includes-enterprise-level-github-copilot-cli-activity/) |
| Feb 27 | v0.0.420 | **Auto-update binær** — Auto-update oppdaterer nå også binær-executable, ikke bare JS-pakken; 502-retry | [GitHub Releases](https://github.com/github/copilot-cli/releases) |

**OpenAI Codex CLI (februar 20-28):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Feb 26 | v0.106.0 | **Direct install script** — macOS/Linux installasjon via GitHub release asset (inkluderer codex + rg) | [GitHub](https://github.com/openai/codex/releases) |
| Feb 26 | v0.106.0 | **`request_user_input` i Default mode** — Codex kan nå spørre brukeren interaktivt også utenfor Plan mode | [GitHub](https://github.com/openai/codex/releases) |
| Feb 26 | v0.106.0 | **Diff-basert memory** — "Diff-based forgetting" og bruksbevisst minneseleksjon | [GitHub](https://github.com/openai/codex/releases) |
| Feb 26 | v0.106.0 | **5.3-codex synlig** — GPT-5.3-Codex nå synlig i CLI modell-listen for API-brukere | [GitHub](https://github.com/openai/codex/releases) |
| Feb 26 | v0.106.0 | **Sikkerhet** — Fikset zsh shell execution sandbox-sårbarhet, ~1M tegn input-cap | [GitHub](https://github.com/openai/codex/releases) |
| Feb 27-28 | alpha | **v0.107.0-alpha.1-8** — 8 alpha-bygg mot neste stabile release | [GitHub](https://github.com/openai/codex/releases) |

**Gemini CLI (februar 20-28):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Feb 27 | v0.31.0 | **Gemini 3.1 Pro preview-støtte** — Googles nyeste modelliterasjon tilgjengelig i CLI | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 27 | v0.31.0 | **Eksperimentell Browser Agent** — Direkte interaksjon med nettsider for automatisk kontekstinnhenting | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 27 | v0.31.0 | **SDK med custom skills** — Initialt SDK-pakke, dynamiske system instructions, SessionContext for tool calls | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 27 | v0.31.0 | **Forbedret Policy Engine** — Prosjektnivå-policies, MCP server wildcards, tool annotation matching | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 27 | v0.31.0 | **Plan Mode forbedret** — Custom lagringskatalog, automatisk modellbytte, automatisk arbeidsoppsummering | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 27 | v0.31.0 | **Sikkerhet** — Unicode-stripping, deceptive URL-deteksjon, DDoS-mitigering for web fetch | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 20-27 | v0.29.1-6 | **Patch-releases** — Stabilitetsforbedringer og feilrettinger | [Gemini CLI](https://geminicli.com/docs/changelogs/) |

**Relevans for doc-aide:**

- ⭐ **Copilot CLI er GA!** — Fra preview til produksjonsklar. Alle Copilot-abonnenter har nå tilgang, inkludert Business-tier
- ⭐ **Claude + Codex i Copilot Business** — Organisasjoner kan nå bruke Claude/Codex som agenter i Copilot uten Pro+-krav
- ⭐ **Worktree-delt minne (Claude Code)** — Project configs og auto memory deles automatisk på tvers av worktrees — løser et problem vi har jobbet rundt manuelt
- ⭐ **HTTP hooks (Claude Code)** — Kan nå POSTe JSON til URL-er fra hooks, åpner for Slack-varsling, logging, etc.
- ⭐ **Gemini Browser Agent** — Direkte nettleser-interaksjon, ligner Claude Codes Chrome Beta men native i Gemini
- ✅ **`/simplify` og `/batch` (Claude Code)** — Nye innebygde skills vi kan studere som referanse for egne skills
- ✅ **Gemini SDK med custom skills** — Alle fire CLI-verktøy har nå SDK for programmatisk tilgang
- ✅ **Diff-basert memory (Codex)** — Smartere minnehåndtering, alle verktøy konvergerer mot persistent memory
- ✅ **Sikkerhetsfokus alle verktøy** — Sandbox-sårbarheter, workspace trust, Unicode-stripping — modenheten øker
- ✅ **Auto-memory forbedret (Claude Code)** — Automatisk lagring + `/memory`-kommando for administrasjon

---

### 2026-02-20

**Claude Code (februar 14-20):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Feb 17 | v2.1.45 | **Claude Sonnet 4.6** — Ny modell, erstatter Sonnet 4.5 på Max-plan (også 1M context) | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb 18-19 | v2.1.47 | **Mega-release (60+ endringer)** — Massiv Windows-stabilitetspush, minnelekkasjer fikset, VS Code plan preview med auto-updates | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 20 | v2.1.49 | **Worktree mode** (`--worktree`/`-w`) — Isolert git-utvikling, subagents med `isolation: "worktree"` | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 20 | v2.1.49 | **Background agents** — `background: true` i agent-definisjoner, `Ctrl+F` for å drepe bakgrunnsagenter | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 17 | v2.1.46 | **claude.ai MCP connectors** — Støtte for MCP-koblinger fra claude.ai i Claude Code | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb 17 | v2.1.45 | **SDK rate limiting** — `SDKRateLimitInfo`/`SDKRateLimitEvent` typer for statusoppdateringer | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb 14-20 | div. | **Minneforbedringer** — Frigjør API stream buffers, agent context, skill state i lange sesjoner, periodisk tree-sitter WASM reset | [GitHub](https://github.com/anthropics/claude-code/releases) |

**GitHub Copilot CLI (februar 14-20):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Feb 17 | - | **Agentic Workflows** (technical preview) — AI-agenter i GitHub Actions! Markdown-baserte workflows, støtter Copilot/Claude/Codex | [The Register](https://www.theregister.com/2026/02/17/github_previews_agentic_workflows/) |
| Feb 17 | v0.0.411 | **Autopilot mode + `/fleet` GA** — Tilgjengelig for alle brukere (tidligere begrenset) | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Feb 17 | v0.0.411 | **Claude Sonnet 4.6 modellstøtte** + `include_coauthor` config for git commits | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Feb 14 | v0.0.410 | **User-level instructions** — `~/.copilot/instructions/*.instructions.md` for alle repos | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Feb 14 | v0.0.410 | **Store minnelekkasjefiks** — Rask logging, encoding av streaming chunks, store sesjoner | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Feb 19 | v0.0.412 | **Accessibility** — Screen reader-vennlig quick help, skjuler `user-invocable: false` agenter | [GitHub Releases](https://github.com/github/copilot-cli/releases) |

**OpenAI Codex CLI (februar 14-20):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Feb 18 | v0.104.0 | **WebSocket proxy** — `WS_PROXY`/`WSS_PROXY` env-variabler for Codex-Spark-infrastruktur | [GitHub Releases](https://github.com/openai/codex/releases) |
| Feb 17 | v0.103.0 | **Commit co-author** — Ny `prepare-commit-msg` hook med konfigurasjon, rikere app metadata | [GitHub Releases](https://github.com/openai/codex/releases) |
| Feb 17 | v0.102.0 | **Unified permissions** — Klarere tilgangshistorikk i TUI, multi-agent roles konfigurerbart | [GitHub Releases](https://github.com/openai/codex/releases) |
| Feb 18-19 | alpha | **v0.105.0-alpha.1-6** — 6 alpha-bygg mot neste stabile release | [GitHub Releases](https://github.com/openai/codex/releases) |

**Gemini CLI (februar 14-20):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Feb 17 | v0.29.0 | **Plan Mode** (`/plan`) — Les-only research mode for arkitektur før implementering | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 17 | v0.29.0 | **Gemini 3 som standard** — Preview feature flag fjernet, Gemini 3 nå default for alle | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 17 | v0.29.0 | **Ask User Tool** — Modellen kan pause og spørre brukeren interaktivt | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 17 | v0.29.0 | **Extension Discovery** — Registry-klient for å oppdage og installere extensions | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 19 | v0.30.0-preview.3 | **SDK package** — Støtte for custom skills og dynamiske system instructions | [Gemini CLI](https://geminicli.com/docs/changelogs/preview/) |
| Feb 19 | - | **Gemini 3.1 Pro** annonsert (preview) — Tilgjengelig i API, AI Studio, Gemini CLI, Vertex AI | [Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/gemini-3-1-pro-on-gemini-cli-gemini-enterprise-and-vertex-ai) |

**Relevans for doc-aide:**

- ⭐ **Agentic Workflows (GitHub)** — Potensielt game-changer: AI-agenter (Copilot/Claude/Codex) kjører direkte i GitHub Actions med Markdown-baserte workflows
- ⭐ **Worktree mode (Claude Code)** — Native `--worktree` støtte, vi bruker allerede worktrees i doc-aide
- ⭐ **Sonnet 4.6 i Claude Code + Copilot** — Ny modell tilgjengelig i begge verktøy vi bruker
- ⭐ **Gemini Plan Mode + Ask User** — Gemini konvergerer mot Claude Codes plan mode-konsept
- ✅ **Background agents forbedret** — `background: true` og `Ctrl+F` gir bedre kontroll over bakgrunnsagenter
- ✅ **User-level instructions (Copilot)** — `~/.copilot/instructions/` ligner Claude Codes globale CLAUDE.md
- ✅ **Gemini 3.1 Pro** — Rask modelliterasjon fra Google, preview allerede tilgjengelig
- ✅ **Minneforbedringer (alle verktøy)** — Alle fire CLI-verktøy fokuserer på stabilitet i lange sesjoner

---

### 2026-02-14

**Claude Code (februar 6-14):**

| Dato | Nyhet | Kilde |
|------|-------|-------|
| Feb 10 | **VS Code remote sessions** — OAuth-brukere kan bla i/gjenoppta sesjoner fra claude.ai, git branch i session picker | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb 10 | **Stabilitetsforbedringer** — Fikset VS Code terminal scroll, Tab-tast slash command-queueing, bash permission matching | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb 10 | **Ytelsesforbedringer** — Deferred Zod schema construction, forbedret terminal rendering | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb 5-10 | **CLI auth commands** — `claude auth login/status/logout`, Windows ARM64-støtte, forbedret `/rename` (auto-genererer sesjonsnavn) | [ClaudeLog](https://claudelog.com/claude-code-changelog/) |

**GitHub Copilot CLI (februar 6-14):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Feb 12 | v0.0.409 | **/diff i fullskjerm** — Alt-screen mode, ny quick help overlay (`?`), `list_copilot_spaces` tool | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Feb 12 | v0.0.408 | **/streamer-mode** — Skjuler modellnavn og kvotedetaljer, forbedrede background task hints | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Feb 7 | v0.0.406 | **Plugins → Skills rename** — Plugins oversettes til skills, **Claude Opus 4.6 Fast** (preview), `/changelog` kommando, MCP strukturert innhold (bilder/ressurser) | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Feb 7 | v0.0.406 | **Plugin marketplace URLs** — Aksepterer URL-er som kilder, `--no-experimental` flag, `/mcp show` viser enabled/disabled | [GitHub Releases](https://github.com/github/copilot-cli/releases) |

**OpenAI Codex CLI (februar 6-14):**

| Dato | Nyhet | Kilde |
|------|-------|-------|
| Feb 12 | **GPT-5.3-Codex-Spark** (research preview) — Ultra-lav latens (1000+ tokens/sek), 128k context, for sanntids-koding | [OpenAI](https://openai.com/index/introducing-gpt-5-3-codex-spark/) |
| Feb 12 | **npm packaging rework** — Plattformspesifikke binærfiler via `@openai/codex` dist-tags, redusert pakkestørrelse | [GitHub Releases](https://github.com/openai/codex/releases) |
| Feb 6-14 | **Memory-forbedringer** — Developer messages ekskludert fra fase-1 memory, redusert concurrency for stabilitet | [Codex Changelog](https://developers.openai.com/codex/changelog/) |

**Gemini CLI (februar 6-14):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Feb 10 | v0.28.0 | **/prompt-suggest** — Ny kommando for prompt-assistanse, auto theme switching, Positron IDE-kompatibilitet, background shell execution | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 10 | v0.28.0 | **Enhanced subagents** — Dynamisk policy-registrering, generisk Checklist-komponent, OAuth consent (interaktiv + non-interaktiv) | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 12 | v0.28.1 | **Extension settings** — API keys/base URLs/passord konfigurerbare ved installasjon, custom themes for extensions | [GitHub Discussion](https://github.com/google-gemini/gemini-cli/discussions/18940) |
| Feb 10 | v0.29.0-preview | **Plan Mode major update** — MCP-serverstøtte i planlegging, autocomplete i input prompt, DevTools-integrasjon | [Gemini CLI](https://geminicli.com/docs/changelogs/preview/) |
| Feb | - | **Gemini Code Assist: Agent Mode GA** — Tilgjengelig for alle i VS Code og IntelliJ, inline diff, repo-upload (opptil 1000 filer/100MB) | [Google Devs](https://developers.google.com/gemini-code-assist/resources/release-notes) |
| Feb | - | ⚠️ **Gemini 2.0 Flash avvikles 31. mars 2026** — Utviklere må migrere til nyere modeller | [Google AI](https://ai.google.dev/gemini-api/docs/changelog) |

**Relevans for doc-aide:**

- ⭐ **Copilot: Plugins → Skills** — Copilot bruker nå samme "skills"-terminologi som Claude og Codex, konvergensen fortsetter
- ⭐ **GPT-5.3-Codex-Spark** — 1000+ tokens/sek åpner for sanntids-koding, kan endre forventninger til responstid
- ⭐ **Gemini Plan Mode med MCP** — Planlegging kan nå bruke MCP-servere, ligner på Claude Codes plan mode
- ✅ **Claude Code VS Code remote sessions** — Sømløs overgang mellom claude.ai og VS Code
- ✅ **Gemini Code Assist Agent Mode GA** — Alle fire verktøy har nå agent mode i produksjon
- ✅ **Copilot /diff fullskjerm** — Bedre diff-visning for code review i terminal
- ⚠️ **Gemini 2.0 Flash avvikles** — Må migrere til nyere modeller innen 31. mars

---

### 2026-02-06

**Claude Code (januar-februar 2026):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Feb 5 | - | **Claude Opus 4.6 lansert** — Anthropics kraftigste modell, 1M token context (beta), slår GPT-5.2 med 144 Elo på GDPval-AA | [Anthropic](https://www.anthropic.com/news/claude-opus-4-6) |
| Feb 5 | - | **Agent Teams** (research preview) — Multi-agent-samarbeid, krever `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | [TechCrunch](https://techcrunch.com/2026/02/05/anthropic-releases-opus-4-6-with-new-agent-teams/) |
| Feb | - | **Auto-memories** — Claude registrerer og henter automatisk minner mens den jobber | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb | - | **"Summarize from here"** — Delvis samtaleoppsummering fra message selector | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb | - | **Skills fra --add-dir** — Skills i `.claude/skills/` fra tilleggskataloger lastes automatisk | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb | - | **PDF page ranges** i Read tool, token metrics, forbedret OAuth og MCP health checks | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Jan 22 | - | **VS Code-extension GA** — @-mention filer, slash commands (/model, /mcp, /context) | [@claudeai](https://x.com/claudeai/status/2013704053226717347) |
| Jan 13 | - | **Cowork lansert** — "Claude Code for the rest of your work" (ikke-tekniske oppgaver) | [@AnthropicAI](https://x.com/AnthropicAI/status/2011176891307475289) |
| Jan 9 | - | **OAuth-innstramming** — Beskyttelse av Max/Pro-abonnementer, OAuth begrenset til offisielle klienter | [@AnthropicAI](https://x.com/AnthropicAI/status/1949898511287226425) |
| Jan | - | **--from-pr** flag — Gjenoppta sesjoner fra PR, automatisk PR-linking | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Jan | - | **/debug** kommando — Feilsøking av aktive sesjoner | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Jan 10 | 2.1.0 | **Claude Code 2.1** — Slash commands og skills slått sammen, release channel (stable/latest), 1096 commits | [Medium](https://medium.com/@joe.njenga/claude-code-2-1-is-here-i-tested-all-16-new-changes-dont-miss-this-update-ea9ca008dab7) |
| Jan 7 | - | **Claude i M365 Copilot som standard** — Anthropic-modeller aktivert by default i Microsoft 365 | [@tomarbuthnot](https://x.com/tomarbuthnot/status/1998320907744379105) |
| Jan | - | **Pre-konfigurert OAuth** for MCP-servere (Slack m.fl.) via `--client-id`/`--client-secret` | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |

**GitHub Copilot CLI (januar-februar 2026):**

| Dato | Nyhet | Kilde |
|------|-------|-------|
| Feb 5 | **Claude Opus 4.6** tilgjengelig som modell i Copilot CLI (v0.0.404) | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Feb 5 | **Plugins med LSP-servere** — Plugins kan bundle LSP-konfigurasjoner (v0.0.405) | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Jan 28 | **ACP (Agent Client Protocol)** i public preview — Industristandard for agent-kommunikasjon, støtter stdio/TCP, multi-agent-systemer, CI/CD-integrasjon | [GitHub Blog](https://github.blog/changelog/2026-01-28-acp-support-in-copilot-cli-is-now-in-public-preview/) |
| Jan 21 | **Installasjon via GitHub CLI** — `gh copilot` direkte | [GitHub Blog](https://github.blog/changelog/2026-01-21-install-and-use-github-copilot-cli-directly-from-the-github-cli/) |
| Jan 14 | **Spesialiserte agenter**: Explore (kodebase-analyse) og Task (kjør tester/bygg) | [GitHub Blog](https://github.blog/changelog/2026-01-14-github-copilot-cli-enhanced-agents-context-management-and-new-ways-to-install/) |
| Jan 14 | **Copilot SDK** (technical preview) — Programmatisk tilgang via Node.js, Python, Go, .NET | [@GHchangelog](https://x.com/GHchangelog/status/2011583752150138977) |
| Jan | **Nye modeller**: GPT-5 mini og GPT-4.1 (inkludert i abonnement, ingen premium requests) | [@GHchangelog](https://x.com/GHchangelog/status/2011567967151206850) |
| Jan | **Plan mode + /review** — Samarbeid med Copilot i Plan mode, ny /review-kommando | [@GHchangelog](https://x.com/GHchangelog/status/2014198247867257057) |

**OpenAI Codex CLI (januar-februar 2026):**

| Dato | Nyhet | Kilde |
|------|-------|-------|
| Feb 5 | **GPT-5.3-Codex lansert** — Kombinerer GPT-5.2-Codex + GPT-5.2 reasoning, 25% raskere, ny SotA på SWE-Bench Pro | [@OpenAI](https://x.com/OpenAI/status/2019474152743223477) |
| Feb 5 | **Mid-turn steering** — Send meldinger mens Codex jobber for å styre oppførselen | [OpenAI](https://openai.com/index/introducing-gpt-5-3-codex/) |
| Feb 5 | ⚠️ **Cybersikkerhet: "high" risk** — Første modell som treffer "high" på OpenAIs preparedness framework | [Fortune](https://fortune.com/2026/02/05/openai-gpt-5-3-codex-warns-unprecedented-cybersecurity-risks/) |
| Feb | **Codex app for macOS** — Ny desktop-app, dobling av rate limits for betalende brukere | [@OpenAI](https://x.com/OpenAI/status/2018385568992752059) |
| Jan | **Ny IDE-extension + GitHub code reviews** — Flytt oppgaver mellom cloud og lokalt miljø | [@OpenAIDevs](https://x.com/OpenAIDevs/status/1960809814596182163) |
| Jan 16 | **SKILL.toml** — Skill metadata nå definerbar i TOML-format (v0.86.0) | [Codex Changelog](https://developers.openai.com/codex/changelog/) |
| Jan 15 | **Parallell shell-kjøring** — Shell-verktøy kan nå kjøre parallelt for bedre throughput | [Codex Changelog](https://developers.openai.com/codex/changelog/) |

**Gemini CLI (januar-februar 2026):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Feb 3 | v0.27.0 | **Agent Skills stabil** — Promotert fra preview til stabil feature | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 3 | v0.27.0 | **Event-driven tool execution** — Ny arkitektur for bedre ytelse og responsivitet | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Jan 27 | v0.26.0 | **skill-creator skill** + generalist agent for task routing, `/rewind` kommando | [GitHub Discussion](https://github.com/google-gemini/gemini-cli/discussions/17812) |
| Jan 20 | v0.25.0 | **Skills aktivert som standard** — pr-creator skill, `/agents refresh` kommando | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| Jan 14 | v0.24.0 | **Remote agents** — Støtte for fjernagenter, visuell hook-feedback, sikkerhetsforbedringer | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| Jan 7 | v0.23.0 | **Agent Skills i preview** — Windows clipboard, `/logout` kommando | [Gemini CLI](https://geminicli.com/docs/changelogs/) |

**Relevans for doc-aide:**

- ⭐ **Opus 4.6 + Agent Teams** — Kan revolusjonere multi-steg workflows (analyse → koding → testing parallelt)
- ⭐ **ACP (Agent Client Protocol)** — Ny industristandard fra GitHub for agent-kommunikasjon, potensielt viktigere enn MCP for agent-til-agent
- ⭐ **Skills er nå stabil i ALLE fire verktøy** — Gemini siste til å promotere til stabil (v0.27)
- ⭐ **Mid-turn steering i Codex** — Ny interaksjonsmodell der du styrer agenten underveis
- ✅ **Claude Code 2.1** — Slash commands og skills slått sammen = enklere mental modell
- ✅ **Copilot har Opus 4.6** — Våre doc-aide workflows kan kjøres med Opus 4.6 i Copilot
- ✅ **Auto-memories i Claude Code** — Mindre behov for manuell MEMORY.md-vedlikehold
- ✅ **--from-pr i Claude Code** — Kan gjenoppta arbeid direkte fra PR
- ⚠️ **GPT-5.3-Codex "high" cybersecurity risk** — Industrien tar sikkerhetsrisiko mer alvorlig
- ⚠️ **SKILL.toml (Codex) vs SKILL.md (Claude/Copilot)** — Ulik metadata-format, men konseptet er likt

---

### 2026-01-05

**Claude Code (desember 2025):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| Des 10 | 2.0.64 | **Asynkrone agenter** - Kjør sub-agents i bakgrunnen | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Des 10 | 2.0.64 | **/stats** - Bruksstatistikk, favorittmodell, streak | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Des 10 | 2.0.64 | **Navngitte sesjoner** - `/rename` + `/resume <name>` | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Des 11 | 2.0.65 | **Alt+P modellbytte** - Bytt modell mens du skriver prompt | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Des 17 | 2.0.72 | **Chrome Beta** - Kontroller nettleser fra Claude Code | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Des 17 | 2.0.72 | **Thinking toggle** endret fra Tab til Alt+T | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Des 20 | 2.0.74 | **LSP-støtte** - go-to-definition, find references, hover | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |

**GitHub Copilot CLI (desember 2025):**

| Dato | Nyhet | Kilde |
|------|-------|-------|
| Des 18 | **Agent Skills** - Copilot leser `.claude/skills/` automatisk! | [GitHub Blog](https://github.blog/changelog/2025-12-18-github-copilot-now-supports-agent-skills/) |
| Des 19 | **/context kommando** - Visualiser token-bruk | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Des 19 | **--resume flag** - Fortsett remote sessions lokalt | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Des 30 | **Tab completion** for path arguments i slash commands | [GitHub Releases](https://github.com/github/copilot-cli/releases) |

**OpenAI Codex CLI (desember 2025):**

| Dato | Nyhet | Kilde |
|------|-------|-------|
| Des 18 | **GPT-5.2-Codex** - Ny agentic coding-modell, 56.4% på SWE-Bench Pro | [OpenAI](https://openai.com/index/introducing-gpt-5-2-codex/) |
| Des 19 | **Skills-støtte** - `~/.codex/skills/` (samme konsept som Claude) | [Codex Changelog](https://developers.openai.com/codex/changelog) |

**Gemini CLI (november-desember 2025):**

| Dato | Nyhet | Kilde |
|------|-------|-------|
| Nov 18 | **Gemini 3 Pro** - Bedre reasoning og tool use | [Google Blog](https://developers.googleblog.com/en/5-things-to-try-with-gemini-3-pro-in-gemini-cli/) |
| Des 5 | **IntelliJ 1.40.0** - Outline (auto-docs) + Finish Changes | [Google Devs](https://developers.google.com/gemini-code-assist/resources/release-notes) |
| Des 17 | **Gemini 3 Flash** i CLI - 78% på SWE-bench | [Google Blog](https://developers.googleblog.com/gemini-3-flash-is-now-available-in-gemini-cli/) |

**Relevans for doc-aide:**

- ⭐ **Skills er nå standard** - Claude, Copilot og Codex bruker alle skills-konseptet
- ⭐ **MCP er standard** - Alle fire CLI-verktøy støtter MCP
- ✅ **Copilot leser `.claude/skills/`** - Våre skills fungerer i Copilot CLI
- ✅ **LSP i Claude Code** - Bedre kodenavigering
- ✅ **Asynkrone agenter** - Kan forbedre Task-baserte workflows

---

### 2025-11-29

**Anthropic / Claude:**

| Dato | Nyhet | Kilde |
|------|-------|-------|
| Nov 24 | **Claude Opus 4.5 lansert** - "best model for coding, agents", ny `effort` parameter | [anthropic.com/news](https://www.anthropic.com/news/claude-opus-4-5) |
| Nov 18 | Claude i Microsoft 365 Copilot + Azure | [anthropic.com/news](https://www.anthropic.com/news) |
| Nov 18 | Microsoft, NVIDIA, Anthropic partnerskap | [anthropic.com/news](https://www.anthropic.com/news) |
| Nov 13 | AI-orchestrated cyber espionage disruption | [anthropic.com/news](https://www.anthropic.com/news) |

**GitHub Copilot:**

| Dato | Nyhet | Kilde |
|------|-------|-------|
| Nov 25 | Copilot agent sessions på GitHub Mobile (Android) | [github.blog/changelog](https://github.blog/changelog/label/copilot/) |
| Nov 24 | **Claude Opus 4.5 i Copilot** (public preview) | [github.blog/changelog](https://github.blog/changelog/label/copilot/) |
| Nov 20 | Linter integration med code review (public preview) | [github.blog/changelog](https://github.blog/changelog/label/copilot/) |
| Nov 18 | **Copilot CLI: nye modeller, code search, image support** | [github.blog/changelog](https://github.blog/changelog/label/copilot/) |
| Nov 18 | Gemini 3 Pro i Copilot (public preview) | [github.blog/changelog](https://github.blog/changelog/label/copilot/) |
| Nov 13 | GPT-5.1 i Copilot (public preview) | [github.blog/changelog](https://github.blog/changelog/label/copilot/) |
| Nov 10 | Claude Haiku 4.5 i Copilot Free | [github.blog/changelog](https://github.blog/changelog/label/copilot/) |
| Nov 05 | Org-level custom instructions og PR templates | [github.blog/changelog](https://github.blog/changelog/label/copilot/) |

**Google Gemini:**

| Dato | Nyhet | Kilde |
|------|-------|-------|
| Nov 20 | IntelliJ Gemini Code Assist 1.39.1 | [developers.google.com](https://developers.google.com/gemini-code-assist/resources/release-notes) |
| Nov 12 | Code Customization i Agent Mode og Gemini CLI | [developers.google.com](https://developers.google.com/gemini-code-assist/resources/release-notes) |
| Nov 10 | Persistent Memory for Gemini Code Assist | [developers.google.com](https://developers.google.com/gemini-code-assist/resources/release-notes) |
| **Okt 14** | **Tools deprecated → Agent mode + MCP** | [developers.google.com](https://developers.google.com/gemini-code-assist/resources/release-notes) |

**Relevans for doc-aide:**

- ⚠️ Modell-IDer oppdatert i TODO-23 (Opus 4.5, Sonnet 4.5, Haiku 4.5)
- ✅ Krysskompatibilitet bekreftet: Copilot støtter Claude direkte
- ⚠️ MCP er fremtiden: Gemini har deprecated tools
