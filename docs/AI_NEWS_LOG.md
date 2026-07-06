# AI Dev Tools — News Log

Living changelog for the three AI dev tools doc-aide supports:
Claude Code, GitHub Copilot CLI and OpenAI Codex CLI.

The log is the research feed that drives continuous improvement of doc-aide.
It is further distilled into two documents:

- [AI_SUPPORT_MATRIX.md](./AI_SUPPORT_MATRIX.md) — distilled current state (versions, mechanisms, follow-up items)
- [`.claude/rules/ai-tools-reference.md`](../.claude/rules/ai-tools-reference.md) — verified config reference loaded into AI context

## Table of contents

- [Maintenance](#maintenance)
  - [Sources](#sources)
- [Notation](#notation)
- [News log](#news-log)
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

## Maintenance

Run the `/check-news` skill to update the log. It fetches changelogs from
the sources below, assesses relevance for doc-aide, adds a new dated
section at the top of the [News log](#news-log), and **flags proposed** changes
to `AI_SUPPORT_MATRIX.md` and `ai-tools-reference.md` that you approve before they
are written.

The skill lives in `.claude/skills/check-news/SKILL.md` — it is repo-local and runs
only when you are working in doc-aide.

### Sources

Canonical changelog sources the skill fetches from (since the last review):

| Tool | Sources |
|---------|--------|
| Claude Code | <https://github.com/anthropics/claude-code/releases> · <https://www.anthropic.com/news> |
| GitHub Copilot CLI | <https://github.blog/changelog/label/copilot/> · <https://github.com/github/copilot-cli/releases> |
| OpenAI Codex CLI | <https://github.com/openai/codex/releases> · <https://developers.openai.com/codex/changelog/> |

---

## Notation

Relevance markers in each review's `Relevance for doc-aide` section:

| Symbol | Meaning |
|--------|-----------|
| ⭐ | Direct impact on doc-aide (requires action) |
| ✅ | Useful, but no immediate action |
| ℹ️ | Informative, low relevance |
| ⚠️ | Breaking change or something that must be verified |

---

## News log

### 2026-05-23

Short period (May 14–23, ~9 days). Quiet after the model wave in the previous period — mostly incremental CLI releases. 
Main findings: **Claude Code renamed `/simplify` to `/code-review`**, and **Gemini 3.5 Flash went GA**.

**Claude Code (May 14–23, v2.1.142 → v2.1.150):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| May 14 | v2.1.142 | **Fast mode now defaults to Opus 4.7** (was 4.6). Plugins with a root `SKILL.md` are shown as skills. New `claude agents` flags (`--add-dir`, `--settings`, `--model`, `--effort` etc.) | [Changelog](https://code.claude.com/docs/en/changelog) |
| May 15 | v2.1.143 | Plugin dependency enforcement (`disable` refuses when other plugins depend on it), `worktree.bgIsolation: "none"`, PowerShell `-ExecutionPolicy Bypass` as the default | [Changelog](https://code.claude.com/docs/en/changelog) |
| May 19 | v2.1.144–145 | `claude agents --json` for scripting, `agent_id`/`parent_agent_id` in OTEL spans, `/plugin` Discover/Browse shows commands/agents/skills/hooks/MCP/LSP, `/resume` for background sessions, `/model` only changes the current session | [Changelog](https://code.claude.com/docs/en/changelog) |
| May 21 | v2.1.146–147 | **`/simplify` renamed to `/code-review`** with optional effort levels (`/code-review high`). Pinned background sessions are kept alive while idle | [Changelog](https://code.claude.com/docs/en/changelog) |
| May 22 | v2.1.149 | `/usage` with per-category breakdown (skills/subagents/plugins/MCP), GFM task-list checkboxes in markdown, `allowAllClaudeAiMcps` managed setting, several security fixes | [Changelog](https://code.claude.com/docs/en/changelog) |

**GitHub Copilot CLI (May 14–23, v1.0.48 → v1.0.51):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| May 18 | v1.0.49 | **`/rubber-duck`** for independent critique, **`/memory`** command for persistent memory, Alpine Linux support | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| May 20 | v1.0.51 | **`/security-review`** for vulnerability assessment, session resumption with `--session-id`, customizable status line, `/chronicle cost-tips` | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| May 21–23 | v1.0.52-x (pre) | Deferred tool loading for custom agents, `/compact` with focus instructions, vertical scrollbar with mouse drag | [GitHub Releases](https://github.com/github/copilot-cli/releases) |

**GitHub Copilot Platform (May 14–21):**

| Date | News | Source |
|------|-------|-------|
| May 14 | **GitHub Copilot app in technical preview**, team-level usage metrics via API | [GitHub Blog](https://github.blog/changelog/label/copilot/) |
| May 17 | **GPT-5.3-Codex base model for Copilot Business/Enterprise** | [GitHub Blog](https://github.blog/changelog/label/copilot/) |
| May 18 | Copilot cloud agent (fast/cheap models), **Remote control of CLI sessions GA** (mobile/web/VS Code), Copilot Spaces API GA | [GitHub Blog](https://github.blog/changelog/label/copilot/) |
| May 19 | **Gemini 3.5 Flash GA for Copilot**, code review feedback can be applied via the cloud agent | [GitHub Blog](https://github.blog/changelog/label/copilot/) |
| May 21 | Copilot for Eclipse open source | [GitHub Blog](https://github.blog/changelog/label/copilot/) |

**OpenAI Codex CLI (May 18–21, v0.131 → v0.133):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| May 18 | v0.131.0 | Unified `@`-mentions (files/directories/plugins/skills), plugin marketplace CLI with version-aware sharing, **`codex doctor`** diagnostics, Python SDK → `openai-codex` | [GitHub](https://github.com/openai/codex/releases) |
| May 20 | v0.132.0 | Python SDK first-class auth (API key / ChatGPT / device-code), `codex exec resume --output-schema` for structured output | [GitHub](https://github.com/openai/codex/releases) |
| May 21 | v0.133.0 | **Goals enabled by default** with dedicated storage + progression, permission profiles with a list API and inheritance | [GitHub](https://github.com/openai/codex/releases) |

Platform: **Codex app 26.519** (May 21) — Appshots (send the frontmost app window to Codex), Goal mode GA across app/IDE/CLI, remote computer use.

**Gemini CLI (May 14–22, v0.42.0 → v0.43.0):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| May 17 | nightly | Gemini 3.1 model aliases, security updates | [GitHub](https://github.com/google-gemini/gemini-cli/releases) |
| May 22 | v0.43.0 | **Surgical code edits** — the model is steered toward the `edit` tool for precise changes (faster/more precise), session export/import, adaptive token estimation | [Gemini CLI](https://geminicli.com/docs/changelogs/) |

**New models:**

| Date | Model | Details | Source |
|------|--------|----------|-------|
| May 19 | **Gemini 3.5 Flash** | GA for GitHub Copilot | [GitHub Blog](https://github.blog/changelog/label/copilot/) |
| May 14 | **Opus 4.7 (Fast mode)** | Fast mode in Claude Code now defaults to Opus 4.7 (was 4.6) | [Changelog](https://code.claude.com/docs/en/changelog) |

**Relevance for doc-aide:**

- ⚠️ **`/simplify` renamed to `/code-review` (Claude Code v2.1.147)** — `core/rules/llm-discipline.md:57` (and the generated `implementations/copilot/AGENTS.md:537`) refer to "the `/simplify` skill" for "Simplicity first". The reference to the built-in skill is now outdated. Should be verified against the local Claude Code version and updated
- ⭐ **Plugins with a root `SKILL.md` shown as skills (Claude Code v2.1.142) + unified `@`-mentions for skills (Codex v0.131)** — several tools are making skill distribution easier; relevant to how doc-aide is packaged and distributed
- ⭐ **`/security-review` (Copilot v1.0.51) + `/code-review` (Claude Code)** — both tools now have a built-in review command; complements `/ultrareview` from the previous period. Can be used on the projects
- ✅ **`/memory` in the Copilot CLI + Copilot Memory for Pro/Pro+** — the memory convergence continues; all tools are maturing persistent memory
- ✅ **Goals default in Codex (v0.133) + `/goal` in Claude Code** — the `/goal` primitive is maturing in both tools
- ✅ **`claude agents --json` (v2.1.145)** — scripting-friendly agent execution, relevant if doc-aide automates agent workflows
- ✅ **Fast mode → Opus 4.7 (Claude Code v2.1.142)** — Fast usage in doc-aide now hits Opus 4.7
- ℹ️ **Codex Appshots/computer use, Copilot for Eclipse, Gemini surgical edits** — product/UX expansions, low priority for doc-aide

---

### 2026-05-14

Big period (March 28 – May 14, ~7 weeks). All four CLI tools had a high release frequency. Main news: **three new frontier models** — Claude Opus 4.7, GPT-5.5 and Gemini 3 Flash — launched during the period.

**Claude Code (March 28 – May 13, v2.1.86 → v2.1.141, ~55 releases):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Mar 31–Apr 2 | v2.1.89–91 | `defer` permission for hooks, `PermissionDenied` hook event, `/powerup` interactive lessons, per-tool MCP result-size override | [Changelog](https://code.claude.com/docs/en/changelog) |
| Apr 9–10 | v2.1.98–101 | **Monitor tool** for streaming background events, subprocess sandboxing with PID namespace (Linux), Vertex AI setup wizard | [Changelog](https://code.claude.com/docs/en/changelog) |
| Apr 13 | v2.1.105 | **PreCompact hook** with blocking capability, `/proactive` alias for `/loop`, `path` parameter for `EnterWorktree` | [Changelog](https://code.claude.com/docs/en/changelog) |
| Apr 14 | v2.1.108 | `ENABLE_PROMPT_CACHING_1H` (1-hour cache TTL), recap feature for session context, `/undo` alias for `/rewind` | [Changelog](https://code.claude.com/docs/en/changelog) |
| Apr 15 | v2.1.110 | `/tui` command (flicker-free fullscreen), push notification tool for mobile notifications, `/focus` command | [Changelog](https://code.claude.com/docs/en/changelog) |
| Apr 16 | v2.1.111 | **Claude Opus 4.7** in Claude Code — new `xhigh` effort level, `/effort` interactive slider, Auto mode on Opus 4.7 for Max. New **`/ultrareview`** for cloud-based code review | [Changelog](https://code.claude.com/docs/en/changelog) |
| Apr 17 | v2.1.113 | **Native binary architecture** — the CLI spawns a native Claude Code binary instead of bundled JavaScript | [Changelog](https://code.claude.com/docs/en/changelog) |
| Apr 23 | v2.1.118–119 | **Vim visual mode**, `/usage` (merged `/cost`+`/stats`), custom themes, hooks can call MCP tools directly (`type: "mcp_tool"`) | [Changelog](https://code.claude.com/docs/en/changelog) |
| Apr 28 | v2.1.120 | **Windows without Git Bash** — PowerShell is used as the shell tool when Bash is missing. `claude ultrareview [target]` non-interactive subcommand for CI | [Changelog](https://code.claude.com/docs/en/changelog) |
| May 4–8 | v2.1.128–136 | **Plugins from `.zip` archives and URLs** (`--plugin-url`), `worktree.baseRef`, auto mode hard deny rules, hooks see `effort.level` | [Changelog](https://code.claude.com/docs/en/changelog) |
| May 11 | v2.1.139 | **Agent View (research preview)** — `claude agents` command, **`/goal` command** with completion conditions and live overlay | [Changelog](https://code.claude.com/docs/en/changelog) |

Platform: **Routines on Claude Code on the web** (templated cloud agents triggered by schedule/GitHub event/API), **mobile push notifications**, **Claude Design** (research preview — prototypes/slides/mockups), **Computer use** coming to the CLI (research preview), **Advisor tool** (Sonnet/Haiku consults Opus on hard decisions).

**GitHub Copilot CLI (March 30 – May 14, v1.0.13 → v1.0.48):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Apr 4 | v1.0.18 | **Critic agent** — automatically reviews plans with a complementary model | [Changelog](https://github.com/github/copilot-cli/blob/main/changelog.md) |
| Apr 13 | v1.0.25 | **Remote control of CLI sessions** (`--remote`/`/remote`), MCP installation from the registry, `/env` command | [Changelog](https://github.com/github/copilot-cli/blob/main/changelog.md) |
| Apr 16 | v1.0.29 | **Claude Opus 4.7 support** | [Changelog](https://github.com/github/copilot-cli/blob/main/changelog.md) |
| Apr 17 | v1.0.32 | **`auto` as a model** — Copilot automatically picks the best model. Warnings at 75%/90% of the weekly usage limit | [Changelog](https://github.com/github/copilot-cli/blob/main/changelog.md) |
| Apr 23 | v1.0.35 | HTTP hook support (POST JSON), named sessions, tab completion for slash arguments, user settings → `~/.copilot/settings.json` | [Changelog](https://github.com/github/copilot-cli/blob/main/changelog.md) |
| May 1 | v1.0.40 | **`/research`** orchestrator/subagent mode, `/chronicle` command + session history, skills as slash commands in ACP | [Changelog](https://github.com/github/copilot-cli/blob/main/changelog.md) |
| May 11 | v1.0.45 | **`/autopilot`** and **`/fork`** slash commands, PowerShell 7+ fallback on Windows | [Changelog](https://github.com/github/copilot-cli/blob/main/changelog.md) |

Platform: **Copilot CLI supports BYOK and local models** (Ollama, vLLM, Foundry Local; `COPILOT_OFFLINE=true` for air-gapped use, Apr 7). **Copilot SDK** in public preview (Apr 2). **`gh skill` command** in the GitHub CLI — portable skills across Copilot/Claude Code/Cursor (Apr 16). **Enterprise-managed plugins** in public preview — admins distribute plugins to the whole org via a `.github-private` repo (May 6). **Rubber-duck agent** — Claude reviews GPT sessions, GPT-5.5 reviews Claude sessions.

**OpenAI Codex CLI (March 31 – May 8, v0.117 → v0.130):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Apr 15 | v0.121.0 | **Memory mode controls + memory reset/deletion**, `codex marketplace add`, TUI prompt history with `Ctrl+R` | [GitHub](https://github.com/openai/codex/releases) |
| Apr 20 | v0.122.0 | **Plan Mode can start implementation in a fresh context**, plugin tabbed browsing, `codex app` for Desktop | [GitHub](https://github.com/openai/codex/releases) |
| Apr 23 | v0.124.0 | **Hooks now stable** (inline config, observes MCP/apply_patch/Bash), first-class Amazon Bedrock support | [GitHub](https://github.com/openai/codex/releases) |
| Apr 30 | v0.128.0 | **Persisted `/goal` workflows**, **`codex update` command**, `--full-auto` deprecated → permission profiles | [GitHub](https://github.com/openai/codex/releases) |
| May 7–8 | v0.129–130 | **Modal Vim editing** (`/vim`), **`/hooks` browser**, **`codex remote-control`** headless app server | [GitHub](https://github.com/openai/codex/releases) |

Platform: **The Codex app "Codex for (almost) everything"** — background computer use on macOS, in-app browser, 90+ plugins, PR review in the app (Apr 16 — computer use not available in the EU/EEA). **Codex for Chrome** — Chrome extension that works across tabs in the background (May 7). **Automatic approval reviews** — reviewer agent before execution.

**Gemini CLI (April 1 – May 12, v0.35.3 → v0.42.0):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Apr 1 | v0.36.0 | **Git worktree support** for parallel sessions, native macOS Seatbelt + Windows sandboxing, multi-registry subagent security | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| Apr 14 | v0.38.1 | **Subagents officially launched** — task delegation, isolated context windows, built-in experts (@codebase_investigator etc.) | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| Apr 23 | v0.39.0 | **`/memory inbox`** for review/patching of skills, Plan Mode requires confirmation for skill activation | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| Apr 28 | v0.40.0 | Bundled ripgrep for offline search, MCP resource tools, four-layer memory management system | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| May 5 | v0.41.0 | **Real-time voice mode** with cloud and local backends, enforced workspace trust | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| May 12 | v0.42.0 | Auto Memory Inbox with a canonical-patch contract, Gemma 4 default via the Gemini API, session export/import | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |

**New models — overview:**

| Date | Model | Details | Source |
|------|--------|----------|-------|
| Apr 16 | **Claude Opus 4.7** | Anthropic's most capable GA model. 1M context, 128k output, ~13% lift on coding benchmarks. **Breaking changes:** extended thinking budgets removed, sampling parameters (`temperature`/`top_p`/`top_k`) now return 400 errors, new tokenizer (~1–1.35x token usage). Price unchanged ($5/$25 per M) | [Anthropic](https://www.anthropic.com/news/claude-opus-4-7) |
| ~Apr 16 | **GPT-5.4 mini** | Fast/efficient model in Codex for lighter tasks and subagents (>2x faster than GPT-5 mini) | [OpenAI](https://developers.openai.com/codex/changelog) |
| Apr 22 | **Gemini 3 Flash** | "Frontier intelligence built for speed at a fraction of the cost" — preview via the Gemini API | [Google](https://blog.google/products/gemini/gemini-3-flash/) |
| Apr 23 | **GPT-5.5** | OpenAI's new frontier model — launched in the API, ChatGPT and Codex the same day. GPT-5.5 Pro too. Recommended default in Codex | [OpenAI](https://openai.com/index/introducing-gpt-5-5/) |
| May 7 | **Gemini 3.1 Flash-Lite** | GA — fastest and most cost-effective Gemini 3 model | [Google Cloud](https://cloud.google.com/blog/products/ai-machine-learning/gemini-3-1-flash-lite-is-now-generally-available) |

**Relevance for doc-aide:**

- ⚠️ **Opus 4.7 breaking changes** — sampling parameters (`temperature` etc.) now return 400 errors, extended thinking budgets removed. Check whether `aide-*` scripts or SDK calls set these. The new tokenizer means ~1–1.35x token usage
- ⭐ **Opus 4.7 + `xhigh` effort** — new default model on Max. The `effort` frontmatter (from March) can now be set to `xhigh` for heavy analysis skills
- ⭐ **`/ultrareview` (Claude Code) + Codex automatic reviews + Copilot Critic agent** — all three tools now have cloud-based/automatic code review. Can be used on the projects
- ⭐ **`/goal` command in both Claude Code and Codex** — new workflow primitive with completion conditions. Consider it for long-running doc-aide tasks (migrations, todo plans)
- ⭐ **`gh skill` command** — portable skills across Copilot/Claude Code/Cursor with version pinning and supply chain security. Directly relevant to how doc-aide distributes skills
- ⭐ **Enterprise-managed plugins (Copilot)** — admins can distribute plugins (agents, skills, hooks, MCP) to the whole org via a `.github-private` repo. A possible distribution model for doc-aide in larger organizations
- ⭐ **Plugins from `.zip`/URL (Claude Code v2.1.128+)** — easier distribution of doc-aide as a plugin without a marketplace
- ⭐ **Subagents in the Gemini CLI** — now all four tools have subagents with isolated context windows
- ✅ **HTTP hooks + `defer`/conditional hooks + `type: "mcp_tool"` (Claude Code)** — more powerful hook configuration for the doc-aide install.sh/settings.json
- ✅ **Codex hooks now stable** — all four tools now have stable hooks
- ✅ **Windows PowerShell without Git Bash (Claude Code) + PowerShell 7+ fallback (Copilot)** — better Windows support
- ✅ **BYOK + local models + `COPILOT_OFFLINE` (Copilot CLI)** — air-gapped use, potentially relevant under strict security requirements
- ✅ **Native binary architecture (Claude Code v2.1.113)** — faster startup, lower memory usage
- ✅ **Memory convergence** — Claude Code recap, Codex memory reset, Gemini Auto Memory Inbox — all tools are maturing persistent memory
- ℹ️ **Claude Design, Codex for Chrome, Gemini voice mode** — product expansions, low priority for doc-aide

---

### 2026-03-28

**Claude Code (March 17-27, 10 releases: v2.1.78 → v2.1.86):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Mar 27 | v2.1.86 | **Session-ID header** — `X-Claude-Code-Session-Id` for proxy session aggregation. Skill descriptions capped at 250 characters in `/skills`. VSCode fix: "Not responding" during long-running operations | [Changelog](https://code.claude.com/docs/en/changelog) |
| Mar 26 | v2.1.85 | **Conditional hooks** — the `if` field for hooks uses permission rule syntax. PreToolUse hooks can respond to AskUserQuestion. MCP OAuth RFC 9728 discovery. Deep links up to 5000 characters | [Changelog](https://code.claude.com/docs/en/changelog) |
| Mar 26 | v2.1.84 | **PowerShell tool (Windows preview)**. `managed-settings.d/` drop-in directory for policy fragments. `CwdChanged`/`FileChanged` hook events. Transcript search with `/`. `initialPrompt` in agent frontmatter. `paths:` frontmatter accepts YAML lists. Tokens ≥1M shown as "1.5m" | [Changelog](https://code.claude.com/docs/en/changelog) |
| Mar 25 | v2.1.83 | **Transcript search** (`/` in the transcript, `n`/`N` to step). Pasted images as `[Image #N]` chips. `TaskCreated` hook. `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`. Sandbox `failIfUnavailable`. Plugin `sensitive: true` keychain | [Changelog](https://code.claude.com/docs/en/changelog) |
| Mar 20 | v2.1.81 | **`--bare` flag** for scripted `-p` (skips hooks/LSP/plugins). **`--channels`** permission relay to mobile. 18MB lower startup memory | [Changelog](https://code.claude.com/docs/en/changelog) |
| Mar 19 | v2.1.80 | **Rate limits in the statusline** (`used_percentage`, `resets_at`). `effort` frontmatter for skills. `--channels` research preview for MCP push messages | [Changelog](https://code.claude.com/docs/en/changelog) |
| Mar 18 | v2.1.79 | **`claude auth login --console`**. Turn duration toggle. 18MB lower startup memory | [Changelog](https://code.claude.com/docs/en/changelog) |
| Mar 17 | v2.1.78 | **Line-by-line streaming**. `StopFailure` hook. `effort`/`maxTurns`/`disallowedTools` frontmatter for plugin agents. Linux sandbox improvements | [Changelog](https://code.claude.com/docs/en/changelog) |

**GitHub Copilot CLI (March 18-27, v1.0.8 → v1.0.13):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Mar 27 | v1.0.13 | **`/rewind` timeline picker** — Double-tap Esc opens a timeline to roll back to any point. MCP registry retries. V8 compile cache for faster startup | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Mar 23 | v1.0.11 | **Monorepo support** — Skills, instructions, MCP servers and agents are discovered at each directory level up to the git root. `~/.agents/skills/` as a personal skill directory. `/clear` ends the session, `/new` starts a new one (keeps the old one in the background). MCP policy enforcing | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Mar 20 | v1.0.10 | **Concurrent sessions (experimental)**. `/undo` to undo the last turn. SDK clients can register custom slash commands. `/copy` with HTML formatting (Windows) | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Mar 18 | v1.0.8 | **Alt-screen default**. Extension mode setting. MCP allowlist via the `MCP_ALLOWLIST` feature flag. Hooks in settings.json supported | [GitHub Releases](https://github.com/github/copilot-cli/releases) |

**GitHub Copilot Platform (March 23-26):**

| Date | News | Source |
|------|-------|-------|
| Mar 26 | **@copilot resolves merge conflicts on PRs** | [GitHub Blog](https://github.blog/changelog/) |
| Mar 25 | **Copilot for Jira — Public preview** with expanded features | [GitHub Blog](https://github.blog/changelog/) |
| Mar 24 | **@copilot makes changes directly on PRs** | [GitHub Blog](https://github.blog/changelog/) |
| Mar 24 | **Copilot coding agent repo access via API** | [GitHub Blog](https://github.blog/changelog/) |

**OpenAI Codex CLI (March, v0.117.0):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Mar 26 | v0.117.0 | **Plugins as a first-class workflow** — Sync, browse `/plugins`, install/remove with auth handling. **Sub-agents with path-based addresses** (`/root/agent_a`) and structured inter-agent messaging. `/title` terminal title for parallel sessions. Prompt history in the app-server TUI | [GitHub](https://github.com/openai/codex/releases) |

**Gemini CLI (March 17-28, v0.34.0 → v0.35.3):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Mar 28 | v0.35.3 | Bugfix release | [GitHub](https://github.com/google-gemini/gemini-cli/releases) |
| Mar 24 | v0.35.0 | **Customizable keyboard shortcuts** with the Kitty protocol. Vim mode expanded (X, ~, r, f/F/t/T, yank/paste). **Tool sandbox** with `SandboxManager` and Linux bubblewrap. JIT context discovery for filesystem tools. `--admin-policy` flag | [GitHub](https://github.com/google-gemini/gemini-cli/releases) |
| Mar 17 | v0.34.0 | **Plan Mode default**. Native gVisor (runsc) and experimental LXC container sandboxing | [Gemini CLI](https://geminicli.com/docs/changelogs/) |

**Relevance for doc-aide:**

- ⭐ **Claude Code conditional hooks (`if` field)** — Can be used to create more precise hooks in doc-aide, e.g. only activating for specific file types or branches. Consider for install.sh/settings.json
- ⭐ **Claude Code `effort` frontmatter for skills** — Can set reasoning effort per skill. Useful for heavy analysis skills vs fast workflow skills
- ⭐ **Claude Code `paths:` frontmatter as a YAML list** — Easier path-specific rules. Update ai-tools-reference.md
- ⭐ **Copilot monorepo support (v1.0.11)** — Skills/instructions are discovered at each directory level up to the git root. Important for monorepo-like projects
- ⭐ **Copilot `~/.agents/skills/`** — New personal skill directory. Update ai-tools-reference.md's skill path table
- ✅ **Claude Code `--bare` flag** — Useful for scripts that call Claude programmatically (aide-* scripts)
- ✅ **Claude Code `CwdChanged`/`FileChanged` hooks** — Reactive config handling, potentially useful
- ✅ **Claude Code transcript search** — Useful UX improvement for long sessions
- ✅ **Codex plugins + sub-agents** — Codex is maturing, but low priority for us
- ✅ **Gemini tool sandboxing** — All four CLI tools now have sandboxing
- ℹ️ **Copilot @copilot PR changes** — Platform feature, not CLI-related

---

### 2026-03-15

**Claude Code (March 2026):**

| Date | News | Source |
|------|-------|-------|
| Mar | **Claude Code Security** — New product that reviews codebases for security vulnerabilities | [Anthropic](https://www.anthropic.com/news) |
| Mar | **Commands absorbed into skills** — `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` are now equivalent and both create `/deploy`. Skills are now the overarching concept. `$ARGUMENTS` supported in both. The description budget scales dynamically to 2% of the context window | [Claude Code Docs](https://code.claude.com/docs/en/skills) |
| Jan/Mar | **`/loop` and Cron tools** — Run prompts or slash commands at recurring intervals within a session | [VentureBeat](https://venturebeat.com/orchestration/claude-code-2-1-0-arrives-with-smoother-workflows-and-smarter-agents) |

**GitHub Copilot CLI (March 2026):**

| Date | News | Source |
|------|-------|-------|
| Mar | **`~/.claude/commands/` read as skills** — Copilot imports Claude's slash-command files as skills (source: `/skills info`). `$ARGUMENTS` is ignored, the instructions are read as a natural-language recipe | Discovered in practice |
| Mar | **Cross-session memory** — Copilot remembers conventions, patterns, preferences and previous files/PRs across sessions | [GitHub Changelog](https://github.blog/changelog/) |
| Mar | **`web_fetch` tool** — Fetches URL content as Markdown, allowed/denied URL patterns configured in `~/.copilot/config` | [GitHub Docs](https://docs.github.com/en/copilot) |

**Gemini CLI (March 2026):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Mar 12 | v0.33.1 | **Plan Mode expanded** — Expanded capabilities, built-in research sub-agents, annotation support for between-iteration feedback, new `copy` subcommand, approved plans preserved on chat compaction | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| Mar | - | **Generalist agent enabled** — Improved task delegation and routing, model steering directly in the workspace | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| Mar | - | **UX improvements** — Windows: paste images with `Alt+V`, automatic theme optimization based on terminal color, `/logout` for instant credential clearing, `npx gemini-wrapped` for usage statistics | [Gemini CLI](https://geminicli.com/docs/changelogs/) |

**Relevance for doc-aide:**

- ⭐ **Copilot reads `~/.claude/commands/` as skills** — `~/.claude/commands/` is in practice a shared distribution source for Claude and Copilot. No changes needed in doc-aide — existing commands work in both tools
- ⭐ **Skills/commands unified in Claude Code** — The distinction between skills and slash commands is gradually disappearing. A simpler mental model for the doc-aide design
- ✅ **Claude Code Security** — New tool for security review of codebases — potentially useful for the projects
- ✅ **`/loop` and Cron** — Can be used for periodic reviews or repetitive tasks in doc-aide workflows
- ✅ **Gemini Plan Mode v0.33.1** — All four CLI tools now have a mature plan/analysis mode

---

### 2026-02-28

**Claude Code (February 20-28):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Feb 28 | v2.1.63 | **`/simplify` and `/batch` bundled skills** — New built-in slash commands for code simplification and batch operations | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 28 | v2.1.63 | **HTTP hooks** — POST JSON to URLs from hooks, with sandbox proxy and `allowedEnvVars` protection | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 28 | v2.1.63 | **Worktree-shared memory** — Project configs and auto memory are now shared automatically across git worktrees | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 26 | v2.1.59 | **Auto-memory improved** — Claude automatically saves useful context to auto-memory, managed with `/memory` | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 26 | v2.1.59 | **`/copy` command** — Interactive picker to copy individual code blocks or the whole response | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 25 | v2.1.53 | **Massive Windows stability push** — Fixed WASM crashes, ARM64 crashes, panic errors, EINVAL errors | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 24 | v2.1.51 | **`claude remote-control`** — New subcommand for external builds, custom npm registries, version pinning | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 24 | v2.1.51 | **Security improvements** — `statusLine`/`fileSuggestion` hooks require workspace trust, HTTP hook env vars require `allowedEnvVars` | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 20-28 | misc. | **Memory leak fixes** — Listener leaks, cache leaks, WebSocket leaks, JSON parsing, git root detection | [GitHub](https://github.com/anthropics/claude-code/releases) |

**GitHub Copilot CLI (February 20-28):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Feb 25 | v0.0.416 | **🎉 GENERAL AVAILABILITY** — The Copilot CLI is now GA for all Copilot subscribers (Pro, Pro+, Business, Enterprise) | [GitHub Blog](https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/) |
| Feb 26 | - | **Claude + Codex for Business/Pro** — Claude and Codex now available as coding agents for Copilot Business and Pro (previously Enterprise/Pro+ only) | [GitHub Blog](https://github.blog/changelog/2026-02-26-claude-and-codex-now-available-for-copilot-business-pro-users/) |
| Feb 27 | - | **Enterprise CLI metrics** — Copilot usage metrics now include CLI activity at the enterprise level | [GitHub Blog](https://github.blog/changelog/2026-02-27-copilot-usage-metrics-now-includes-enterprise-level-github-copilot-cli-activity/) |
| Feb 27 | v0.0.420 | **Auto-update binary** — Auto-update now also updates the binary executable, not just the JS package; 502 retry | [GitHub Releases](https://github.com/github/copilot-cli/releases) |

**OpenAI Codex CLI (February 20-28):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Feb 26 | v0.106.0 | **Direct install script** — macOS/Linux installation via GitHub release asset (includes codex + rg) | [GitHub](https://github.com/openai/codex/releases) |
| Feb 26 | v0.106.0 | **`request_user_input` in Default mode** — Codex can now ask the user interactively outside Plan mode too | [GitHub](https://github.com/openai/codex/releases) |
| Feb 26 | v0.106.0 | **Diff-based memory** — "Diff-based forgetting" and usage-aware memory selection | [GitHub](https://github.com/openai/codex/releases) |
| Feb 26 | v0.106.0 | **5.3-codex visible** — GPT-5.3-Codex now visible in the CLI model list for API users | [GitHub](https://github.com/openai/codex/releases) |
| Feb 26 | v0.106.0 | **Security** — Fixed a zsh shell execution sandbox vulnerability, ~1M character input cap | [GitHub](https://github.com/openai/codex/releases) |
| Feb 27-28 | alpha | **v0.107.0-alpha.1-8** — 8 alpha builds toward the next stable release | [GitHub](https://github.com/openai/codex/releases) |

**Gemini CLI (February 20-28):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Feb 27 | v0.31.0 | **Gemini 3.1 Pro preview support** — Google's latest model iteration available in the CLI | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 27 | v0.31.0 | **Experimental Browser Agent** — Direct interaction with web pages for automatic context gathering | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 27 | v0.31.0 | **SDK with custom skills** — Initial SDK package, dynamic system instructions, SessionContext for tool calls | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 27 | v0.31.0 | **Improved Policy Engine** — Project-level policies, MCP server wildcards, tool annotation matching | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 27 | v0.31.0 | **Plan Mode improved** — Custom storage directory, automatic model switching, automatic work summary | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 27 | v0.31.0 | **Security** — Unicode stripping, deceptive URL detection, DDoS mitigation for web fetch | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 20-27 | v0.29.1-6 | **Patch releases** — Stability improvements and bug fixes | [Gemini CLI](https://geminicli.com/docs/changelogs/) |

**Relevance for doc-aide:**

- ⭐ **Copilot CLI is GA!** — From preview to production-ready. All Copilot subscribers now have access, including the Business tier
- ⭐ **Claude + Codex in Copilot Business** — Organizations can now use Claude/Codex as agents in Copilot without a Pro+ requirement
- ⭐ **Worktree-shared memory (Claude Code)** — Project configs and auto memory are shared automatically across worktrees — solves a problem we have worked around manually
- ⭐ **HTTP hooks (Claude Code)** — Can now POST JSON to URLs from hooks, opens up Slack notifications, logging, etc.
- ⭐ **Gemini Browser Agent** — Direct browser interaction, similar to Claude Code's Chrome Beta but native in Gemini
- ✅ **`/simplify` and `/batch` (Claude Code)** — New built-in skills we can study as references for our own skills
- ✅ **Gemini SDK with custom skills** — All four CLI tools now have an SDK for programmatic access
- ✅ **Diff-based memory (Codex)** — Smarter memory handling, all tools are converging on persistent memory
- ✅ **Security focus across all tools** — Sandbox vulnerabilities, workspace trust, Unicode stripping — maturity is increasing
- ✅ **Auto-memory improved (Claude Code)** — Automatic saving + `/memory` command for management

---

### 2026-02-20

**Claude Code (February 14-20):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Feb 17 | v2.1.45 | **Claude Sonnet 4.6** — New model, replaces Sonnet 4.5 on the Max plan (also 1M context) | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb 18-19 | v2.1.47 | **Mega-release (60+ changes)** — Massive Windows stability push, memory leaks fixed, VS Code plan preview with auto-updates | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 20 | v2.1.49 | **Worktree mode** (`--worktree`/`-w`) — Isolated git development, subagents with `isolation: "worktree"` | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 20 | v2.1.49 | **Background agents** — `background: true` in agent definitions, `Ctrl+F` to kill background agents | [GitHub](https://github.com/anthropics/claude-code/releases) |
| Feb 17 | v2.1.46 | **claude.ai MCP connectors** — Support for MCP connections from claude.ai in Claude Code | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb 17 | v2.1.45 | **SDK rate limiting** — `SDKRateLimitInfo`/`SDKRateLimitEvent` types for status updates | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb 14-20 | misc. | **Memory improvements** — Frees API stream buffers, agent context, skill state in long sessions, periodic tree-sitter WASM reset | [GitHub](https://github.com/anthropics/claude-code/releases) |

**GitHub Copilot CLI (February 14-20):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Feb 17 | - | **Agentic Workflows** (technical preview) — AI agents in GitHub Actions! Markdown-based workflows, supports Copilot/Claude/Codex | [The Register](https://www.theregister.com/2026/02/17/github_previews_agentic_workflows/) |
| Feb 17 | v0.0.411 | **Autopilot mode + `/fleet` GA** — Available to all users (previously limited) | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Feb 17 | v0.0.411 | **Claude Sonnet 4.6 model support** + `include_coauthor` config for git commits | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Feb 14 | v0.0.410 | **User-level instructions** — `~/.copilot/instructions/*.instructions.md` for all repos | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Feb 14 | v0.0.410 | **Big memory leak fixes** — Fast logging, encoding of streaming chunks, large sessions | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Feb 19 | v0.0.412 | **Accessibility** — Screen-reader-friendly quick help, hides `user-invocable: false` agents | [GitHub Releases](https://github.com/github/copilot-cli/releases) |

**OpenAI Codex CLI (February 14-20):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Feb 18 | v0.104.0 | **WebSocket proxy** — `WS_PROXY`/`WSS_PROXY` env variables for the Codex-Spark infrastructure | [GitHub Releases](https://github.com/openai/codex/releases) |
| Feb 17 | v0.103.0 | **Commit co-author** — New `prepare-commit-msg` hook with configuration, richer app metadata | [GitHub Releases](https://github.com/openai/codex/releases) |
| Feb 17 | v0.102.0 | **Unified permissions** — Clearer access history in the TUI, multi-agent roles configurable | [GitHub Releases](https://github.com/openai/codex/releases) |
| Feb 18-19 | alpha | **v0.105.0-alpha.1-6** — 6 alpha builds toward the next stable release | [GitHub Releases](https://github.com/openai/codex/releases) |

**Gemini CLI (February 14-20):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Feb 17 | v0.29.0 | **Plan Mode** (`/plan`) — Read-only research mode for architecture before implementation | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 17 | v0.29.0 | **Gemini 3 as the default** — Preview feature flag removed, Gemini 3 now the default for everyone | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 17 | v0.29.0 | **Ask User Tool** — The model can pause and ask the user interactively | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 17 | v0.29.0 | **Extension Discovery** — Registry client for discovering and installing extensions | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 19 | v0.30.0-preview.3 | **SDK package** — Support for custom skills and dynamic system instructions | [Gemini CLI](https://geminicli.com/docs/changelogs/preview/) |
| Feb 19 | - | **Gemini 3.1 Pro** announced (preview) — Available in the API, AI Studio, Gemini CLI, Vertex AI | [Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/gemini-3-1-pro-on-gemini-cli-gemini-enterprise-and-vertex-ai) |

**Relevance for doc-aide:**

- ⭐ **Agentic Workflows (GitHub)** — Potential game-changer: AI agents (Copilot/Claude/Codex) run directly in GitHub Actions with Markdown-based workflows
- ⭐ **Worktree mode (Claude Code)** — Native `--worktree` support, we already use worktrees in doc-aide
- ⭐ **Sonnet 4.6 in Claude Code + Copilot** — New model available in both tools we use
- ⭐ **Gemini Plan Mode + Ask User** — Gemini is converging on Claude Code's plan mode concept
- ✅ **Background agents improved** — `background: true` and `Ctrl+F` give better control over background agents
- ✅ **User-level instructions (Copilot)** — `~/.copilot/instructions/` resembles Claude Code's global CLAUDE.md
- ✅ **Gemini 3.1 Pro** — Fast model iteration from Google, preview already available
- ✅ **Memory improvements (all tools)** — All four CLI tools are focusing on stability in long sessions

---

### 2026-02-14

**Claude Code (February 6-14):**

| Date | News | Source |
|------|-------|-------|
| Feb 10 | **VS Code remote sessions** — OAuth users can browse/resume sessions from claude.ai, git branch in the session picker | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb 10 | **Stability improvements** — Fixed VS Code terminal scroll, Tab key slash command queueing, bash permission matching | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb 10 | **Performance improvements** — Deferred Zod schema construction, improved terminal rendering | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb 5-10 | **CLI auth commands** — `claude auth login/status/logout`, Windows ARM64 support, improved `/rename` (auto-generates session names) | [ClaudeLog](https://claudelog.com/claude-code-changelog/) |

**GitHub Copilot CLI (February 6-14):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Feb 12 | v0.0.409 | **/diff in fullscreen** — Alt-screen mode, new quick help overlay (`?`), `list_copilot_spaces` tool | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Feb 12 | v0.0.408 | **/streamer-mode** — Hides model names and quota details, improved background task hints | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Feb 7 | v0.0.406 | **Plugins → Skills rename** — Plugins are translated to skills, **Claude Opus 4.6 Fast** (preview), `/changelog` command, MCP structured content (images/resources) | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Feb 7 | v0.0.406 | **Plugin marketplace URLs** — Accepts URLs as sources, `--no-experimental` flag, `/mcp show` shows enabled/disabled | [GitHub Releases](https://github.com/github/copilot-cli/releases) |

**OpenAI Codex CLI (February 6-14):**

| Date | News | Source |
|------|-------|-------|
| Feb 12 | **GPT-5.3-Codex-Spark** (research preview) — Ultra-low latency (1000+ tokens/sec), 128k context, for real-time coding | [OpenAI](https://openai.com/index/introducing-gpt-5-3-codex-spark/) |
| Feb 12 | **npm packaging rework** — Platform-specific binaries via `@openai/codex` dist-tags, reduced package size | [GitHub Releases](https://github.com/openai/codex/releases) |
| Feb 6-14 | **Memory improvements** — Developer messages excluded from phase-1 memory, reduced concurrency for stability | [Codex Changelog](https://developers.openai.com/codex/changelog/) |

**Gemini CLI (February 6-14):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Feb 10 | v0.28.0 | **/prompt-suggest** — New command for prompt assistance, auto theme switching, Positron IDE compatibility, background shell execution | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 10 | v0.28.0 | **Enhanced subagents** — Dynamic policy registration, generic Checklist component, OAuth consent (interactive + non-interactive) | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 12 | v0.28.1 | **Extension settings** — API keys/base URLs/passwords configurable at installation, custom themes for extensions | [GitHub Discussion](https://github.com/google-gemini/gemini-cli/discussions/18940) |
| Feb 10 | v0.29.0-preview | **Plan Mode major update** — MCP server support in planning, autocomplete in the input prompt, DevTools integration | [Gemini CLI](https://geminicli.com/docs/changelogs/preview/) |
| Feb | - | **Gemini Code Assist: Agent Mode GA** — Available to everyone in VS Code and IntelliJ, inline diff, repo upload (up to 1000 files/100MB) | [Google Devs](https://developers.google.com/gemini-code-assist/resources/release-notes) |
| Feb | - | ⚠️ **Gemini 2.0 Flash retired March 31, 2026** — Developers must migrate to newer models | [Google AI](https://ai.google.dev/gemini-api/docs/changelog) |

**Relevance for doc-aide:**

- ⭐ **Copilot: Plugins → Skills** — Copilot now uses the same "skills" terminology as Claude and Codex, the convergence continues
- ⭐ **GPT-5.3-Codex-Spark** — 1000+ tokens/sec opens up real-time coding, may change expectations for response time
- ⭐ **Gemini Plan Mode with MCP** — Planning can now use MCP servers, similar to Claude Code's plan mode
- ✅ **Claude Code VS Code remote sessions** — Seamless transition between claude.ai and VS Code
- ✅ **Gemini Code Assist Agent Mode GA** — All four tools now have agent mode in production
- ✅ **Copilot /diff fullscreen** — Better diff viewing for code review in the terminal
- ⚠️ **Gemini 2.0 Flash retired** — Must migrate to newer models by March 31

---

### 2026-02-06

**Claude Code (January-February 2026):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Feb 5 | - | **Claude Opus 4.6 launched** — Anthropic's most powerful model, 1M token context (beta), beats GPT-5.2 by 144 Elo on GDPval-AA | [Anthropic](https://www.anthropic.com/news/claude-opus-4-6) |
| Feb 5 | - | **Agent Teams** (research preview) — Multi-agent collaboration, requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | [TechCrunch](https://techcrunch.com/2026/02/05/anthropic-releases-opus-4-6-with-new-agent-teams/) |
| Feb | - | **Auto-memories** — Claude automatically records and retrieves memories while it works | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb | - | **"Summarize from here"** — Partial conversation summarization from the message selector | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb | - | **Skills from --add-dir** — Skills in `.claude/skills/` from additional directories are loaded automatically | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Feb | - | **PDF page ranges** in the Read tool, token metrics, improved OAuth and MCP health checks | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Jan 22 | - | **VS Code extension GA** — @-mention files, slash commands (/model, /mcp, /context) | [@claudeai](https://x.com/claudeai/status/2013704053226717347) |
| Jan 13 | - | **Cowork launched** — "Claude Code for the rest of your work" (non-technical tasks) | [@AnthropicAI](https://x.com/AnthropicAI/status/2011176891307475289) |
| Jan 9 | - | **OAuth tightening** — Protection of Max/Pro subscriptions, OAuth limited to official clients | [@AnthropicAI](https://x.com/AnthropicAI/status/1949898511287226425) |
| Jan | - | **--from-pr** flag — Resume sessions from a PR, automatic PR linking | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Jan | - | **/debug** command — Troubleshooting of active sessions | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Jan 10 | 2.1.0 | **Claude Code 2.1** — Slash commands and skills merged, release channel (stable/latest), 1096 commits | [Medium](https://medium.com/@joe.njenga/claude-code-2-1-is-here-i-tested-all-16-new-changes-dont-miss-this-update-ea9ca008dab7) |
| Jan 7 | - | **Claude in M365 Copilot by default** — Anthropic models enabled by default in Microsoft 365 | [@tomarbuthnot](https://x.com/tomarbuthnot/status/1998320907744379105) |
| Jan | - | **Pre-configured OAuth** for MCP servers (Slack etc.) via `--client-id`/`--client-secret` | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |

**GitHub Copilot CLI (January-February 2026):**

| Date | News | Source |
|------|-------|-------|
| Feb 5 | **Claude Opus 4.6** available as a model in the Copilot CLI (v0.0.404) | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Feb 5 | **Plugins with LSP servers** — Plugins can bundle LSP configurations (v0.0.405) | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Jan 28 | **ACP (Agent Client Protocol)** in public preview — Industry standard for agent communication, supports stdio/TCP, multi-agent systems, CI/CD integration | [GitHub Blog](https://github.blog/changelog/2026-01-28-acp-support-in-copilot-cli-is-now-in-public-preview/) |
| Jan 21 | **Installation via the GitHub CLI** — `gh copilot` directly | [GitHub Blog](https://github.blog/changelog/2026-01-21-install-and-use-github-copilot-cli-directly-from-the-github-cli/) |
| Jan 14 | **Specialized agents**: Explore (codebase analysis) and Task (run tests/builds) | [GitHub Blog](https://github.blog/changelog/2026-01-14-github-copilot-cli-enhanced-agents-context-management-and-new-ways-to-install/) |
| Jan 14 | **Copilot SDK** (technical preview) — Programmatic access via Node.js, Python, Go, .NET | [@GHchangelog](https://x.com/GHchangelog/status/2011583752150138977) |
| Jan | **New models**: GPT-5 mini and GPT-4.1 (included in the subscription, no premium requests) | [@GHchangelog](https://x.com/GHchangelog/status/2011567967151206850) |
| Jan | **Plan mode + /review** — Collaborate with Copilot in Plan mode, new /review command | [@GHchangelog](https://x.com/GHchangelog/status/2014198247867257057) |

**OpenAI Codex CLI (January-February 2026):**

| Date | News | Source |
|------|-------|-------|
| Feb 5 | **GPT-5.3-Codex launched** — Combines GPT-5.2-Codex + GPT-5.2 reasoning, 25% faster, new SotA on SWE-Bench Pro | [@OpenAI](https://x.com/OpenAI/status/2019474152743223477) |
| Feb 5 | **Mid-turn steering** — Send messages while Codex is working to steer its behavior | [OpenAI](https://openai.com/index/introducing-gpt-5-3-codex/) |
| Feb 5 | ⚠️ **Cybersecurity: "high" risk** — First model to hit "high" on OpenAI's preparedness framework | [Fortune](https://fortune.com/2026/02/05/openai-gpt-5-3-codex-warns-unprecedented-cybersecurity-risks/) |
| Feb | **Codex app for macOS** — New desktop app, doubling of rate limits for paying users | [@OpenAI](https://x.com/OpenAI/status/2018385568992752059) |
| Jan | **New IDE extension + GitHub code reviews** — Move tasks between the cloud and the local environment | [@OpenAIDevs](https://x.com/OpenAIDevs/status/1960809814596182163) |
| Jan 16 | **SKILL.toml** — Skill metadata now definable in TOML format (v0.86.0) | [Codex Changelog](https://developers.openai.com/codex/changelog/) |
| Jan 15 | **Parallel shell execution** — Shell tools can now run in parallel for better throughput | [Codex Changelog](https://developers.openai.com/codex/changelog/) |

**Gemini CLI (January-February 2026):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Feb 3 | v0.27.0 | **Agent Skills stable** — Promoted from preview to a stable feature | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Feb 3 | v0.27.0 | **Event-driven tool execution** — New architecture for better performance and responsiveness | [Gemini CLI](https://geminicli.com/docs/changelogs/latest/) |
| Jan 27 | v0.26.0 | **skill-creator skill** + generalist agent for task routing, `/rewind` command | [GitHub Discussion](https://github.com/google-gemini/gemini-cli/discussions/17812) |
| Jan 20 | v0.25.0 | **Skills enabled by default** — pr-creator skill, `/agents refresh` command | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| Jan 14 | v0.24.0 | **Remote agents** — Support for remote agents, visual hook feedback, security improvements | [Gemini CLI](https://geminicli.com/docs/changelogs/) |
| Jan 7 | v0.23.0 | **Agent Skills in preview** — Windows clipboard, `/logout` command | [Gemini CLI](https://geminicli.com/docs/changelogs/) |

**Relevance for doc-aide:**

- ⭐ **Opus 4.6 + Agent Teams** — Could revolutionize multi-step workflows (analysis → coding → testing in parallel)
- ⭐ **ACP (Agent Client Protocol)** — New industry standard from GitHub for agent communication, potentially more important than MCP for agent-to-agent
- ⭐ **Skills are now stable in ALL four tools** — Gemini the last to promote to stable (v0.27)
- ⭐ **Mid-turn steering in Codex** — New interaction model where you steer the agent along the way
- ✅ **Claude Code 2.1** — Slash commands and skills merged = simpler mental model
- ✅ **Copilot has Opus 4.6** — Our doc-aide workflows can run with Opus 4.6 in Copilot
- ✅ **Auto-memories in Claude Code** — Less need for manual MEMORY.md maintenance
- ✅ **--from-pr in Claude Code** — Can resume work directly from a PR
- ⚠️ **GPT-5.3-Codex "high" cybersecurity risk** — The industry is taking security risk more seriously
- ⚠️ **SKILL.toml (Codex) vs SKILL.md (Claude/Copilot)** — Different metadata formats, but the concept is the same

---

### 2026-01-05

**Claude Code (December 2025):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| Dec 10 | 2.0.64 | **Asynchronous agents** - Run sub-agents in the background | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Dec 10 | 2.0.64 | **/stats** - Usage statistics, favorite model, streak | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Dec 10 | 2.0.64 | **Named sessions** - `/rename` + `/resume <name>` | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Dec 11 | 2.0.65 | **Alt+P model switching** - Switch model while typing a prompt | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Dec 17 | 2.0.72 | **Chrome Beta** - Control the browser from Claude Code | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Dec 17 | 2.0.72 | **Thinking toggle** changed from Tab to Alt+T | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |
| Dec 20 | 2.0.74 | **LSP support** - go-to-definition, find references, hover | [Releasebot](https://releasebot.io/updates/anthropic/claude-code) |

**GitHub Copilot CLI (December 2025):**

| Date | News | Source |
|------|-------|-------|
| Dec 18 | **Agent Skills** - Copilot reads `.claude/skills/` automatically! | [GitHub Blog](https://github.blog/changelog/2025-12-18-github-copilot-now-supports-agent-skills/) |
| Dec 19 | **/context command** - Visualize token usage | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Dec 19 | **--resume flag** - Continue remote sessions locally | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Dec 30 | **Tab completion** for path arguments in slash commands | [GitHub Releases](https://github.com/github/copilot-cli/releases) |

**OpenAI Codex CLI (December 2025):**

| Date | News | Source |
|------|-------|-------|
| Dec 18 | **GPT-5.2-Codex** - New agentic coding model, 56.4% on SWE-Bench Pro | [OpenAI](https://openai.com/index/introducing-gpt-5-2-codex/) |
| Dec 19 | **Skills support** - `~/.codex/skills/` (same concept as Claude) | [Codex Changelog](https://developers.openai.com/codex/changelog) |

**Gemini CLI (November-December 2025):**

| Date | News | Source |
|------|-------|-------|
| Nov 18 | **Gemini 3 Pro** - Better reasoning and tool use | [Google Blog](https://developers.googleblog.com/en/5-things-to-try-with-gemini-3-pro-in-gemini-cli/) |
| Dec 5 | **IntelliJ 1.40.0** - Outline (auto-docs) + Finish Changes | [Google Devs](https://developers.google.com/gemini-code-assist/resources/release-notes) |
| Dec 17 | **Gemini 3 Flash** in the CLI - 78% on SWE-bench | [Google Blog](https://developers.googleblog.com/gemini-3-flash-is-now-available-in-gemini-cli/) |

**Relevance for doc-aide:**

- ⭐ **Skills are now the standard** - Claude, Copilot and Codex all use the skills concept
- ⭐ **MCP is the standard** - All four CLI tools support MCP
- ✅ **Copilot reads `.claude/skills/`** - Our skills work in the Copilot CLI
- ✅ **LSP in Claude Code** - Better code navigation
- ✅ **Asynchronous agents** - Can improve Task-based workflows

---

### 2025-11-29

**Anthropic / Claude:**

| Date | News | Source |
|------|-------|-------|
| Nov 24 | **Claude Opus 4.5 launched** - "best model for coding, agents", new `effort` parameter | [anthropic.com/news](https://www.anthropic.com/news/claude-opus-4-5) |
| Nov 18 | Claude in Microsoft 365 Copilot + Azure | [anthropic.com/news](https://www.anthropic.com/news) |
| Nov 18 | Microsoft, NVIDIA, Anthropic partnership | [anthropic.com/news](https://www.anthropic.com/news) |
| Nov 13 | AI-orchestrated cyber espionage disruption | [anthropic.com/news](https://www.anthropic.com/news) |

**GitHub Copilot:**

| Date | News | Source |
|------|-------|-------|
| Nov 25 | Copilot agent sessions on GitHub Mobile (Android) | [github.blog/changelog](https://github.blog/changelog/label/copilot/) |
| Nov 24 | **Claude Opus 4.5 in Copilot** (public preview) | [github.blog/changelog](https://github.blog/changelog/label/copilot/) |
| Nov 20 | Linter integration with code review (public preview) | [github.blog/changelog](https://github.blog/changelog/label/copilot/) |
| Nov 18 | **Copilot CLI: new models, code search, image support** | [github.blog/changelog](https://github.blog/changelog/label/copilot/) |
| Nov 18 | Gemini 3 Pro in Copilot (public preview) | [github.blog/changelog](https://github.blog/changelog/label/copilot/) |
| Nov 13 | GPT-5.1 in Copilot (public preview) | [github.blog/changelog](https://github.blog/changelog/label/copilot/) |
| Nov 10 | Claude Haiku 4.5 in Copilot Free | [github.blog/changelog](https://github.blog/changelog/label/copilot/) |
| Nov 05 | Org-level custom instructions and PR templates | [github.blog/changelog](https://github.blog/changelog/label/copilot/) |

**Google Gemini:**

| Date | News | Source |
|------|-------|-------|
| Nov 20 | IntelliJ Gemini Code Assist 1.39.1 | [developers.google.com](https://developers.google.com/gemini-code-assist/resources/release-notes) |
| Nov 12 | Code Customization in Agent Mode and the Gemini CLI | [developers.google.com](https://developers.google.com/gemini-code-assist/resources/release-notes) |
| Nov 10 | Persistent Memory for Gemini Code Assist | [developers.google.com](https://developers.google.com/gemini-code-assist/resources/release-notes) |
| **Oct 14** | **Tools deprecated → Agent mode + MCP** | [developers.google.com](https://developers.google.com/gemini-code-assist/resources/release-notes) |

**Relevance for doc-aide:**

- ⚠️ Model IDs updated in TODO-23 (Opus 4.5, Sonnet 4.5, Haiku 4.5)
- ✅ Cross-compatibility confirmed: Copilot supports Claude directly
- ⚠️ MCP is the future: Gemini has deprecated tools
