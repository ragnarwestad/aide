# AI Dev Tools — News Log

## Table of contents

- [Maintenance](#maintenance)
  - [Sources](#sources)
- [Notation](#notation)
- [News log](#news-log)
  - [2026-10-05](#2026-10-05)
  - [2026-10-04](#2026-10-04)
  - [2026-09-30](#2026-09-30)
  - [2026-09-28](#2026-09-28)
  - [2026-09-26](#2026-09-26)
  - [2026-09-21](#2026-09-21)
  - [2026-09-14](#2026-09-14)

---

Living changelog for the four AI dev tools Aide supports:
Claude Code, GitHub Copilot CLI, OpenAI Codex CLI and OpenCode.

The log is the research feed that drives continuous improvement of Aide.
It is further distilled into two documents:

- [AI_SUPPORT_MATRIX.md](./AI_SUPPORT_MATRIX.md) — distilled current state (versions, mechanisms, follow-up items)
- [`.claude/skills/ai-tools-reference/SKILL.md`](../.claude/skills/ai-tools-reference/SKILL.md) — verified config reference, loaded on demand


## Maintenance

Run the `/check-news` skill to update the log. It fetches changelogs from
the sources below, assesses relevance for Aide, adds a new dated
section at the top of the [News log](#news-log), and **flags proposed** changes
to `AI_SUPPORT_MATRIX.md` and `ai-tools-reference.md` that you approve before they
are written.

The skill lives in `.claude/skills/check-news/SKILL.md` — it is repo-local and runs
only when you are working in Aide.

The log keeps the reviews of about the last two months. What mattered in an older review is already in the
two documents above, so `/check-news` deletes reviews older than that when it adds a new one; git history keeps
them.

### Sources

The changelog and news sources the skill fetches from (since the last review). The OpenAI developer blog shows no
dates on its listing, so a post is opened to see when it was published. Artificial Analysis' Coding Agent
Index compares coding agents by score, cost and time per task; its tables are drawn in the browser, so a fetch
sees only placeholders, and what is worth noting there is whether its comparison of the tools themselves has come.

| Tool               | Changelog                                                                                          | News                                                           |
|--------------------|----------------------------------------------------------------------------------------------------|----------------------------------------------------------------|
| Claude Code        | <https://github.com/anthropics/claude-code/releases>                                               | <https://claude.com/blog/><br><https://www.anthropic.com/news> |
| GitHub Copilot CLI | <https://github.com/github/copilot-cli/releases><br><https://github.blog/changelog/label/copilot/> | <https://github.blog/ai-and-ml/github-copilot/>                |
| OpenAI Codex CLI   | <https://github.com/openai/codex/releases><br><https://learn.chatgpt.com/docs/changelog>           | <https://developers.openai.com/blog>                           |
| OpenCode           | <https://github.com/anomalyco/opencode/releases><br><https://opencode.ai/changelog>                | —                                                              |
| All four           | —                                                                                                  | <https://artificialanalysis.ai/agents/coding-agents>           |

---

## Notation

Relevance markers in each review's `Relevance for aide` section:

| Symbol | Meaning                                            |
|--------|----------------------------------------------------|
| ⭐     | Direct impact on Aide (requires action)            |
| ✅     | Useful, but no immediate action                    |
| ℹ      | Informative, low relevance                         |
| ⚠️     | Breaking change or something that must be verified |

---

## News log

### 2026-10-05

Short period (Oct 4 – Oct 5). No new release of Claude Code or OpenCode, and no stable Copilot or Codex release. No
change needed in the support matrix or the reference. Late find: Codex v0.160.0 (Oct 1) was not in the 2026-10-04
review.

**Claude Code (Oct 4 – Oct 5):**

| Date | Version | News                                                                                                            | Source                                                                |
|------|---------|-----------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------|
| —    | —       | No release since v2.1.289 (Oct 3, already logged); Oct 2 Anthropic news: $100 million to train 10,000 engineers | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |

**GitHub Copilot CLI (Oct 4, v1.0.92-3 → v1.0.92-4):**

| Date  | Version         | News                                                                                                                                                                                                                                        | Source                                                            |
|-------|-----------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| Oct 4 | v1.0.92-4 (pre) | New `copilot config` subcommands; faster startup; MCP server connections respond faster; canvas actions return images to the model; fixes for legacy HTTP+SSE MCP connections, voice runtime install errors and shell tool output streaming | [GitHub Releases](https://github.com/github/copilot-cli/releases) |

**OpenAI Codex CLI (Oct 1 – Oct 5):**

| Date          | Version                | News                                                                                                                                                                                                                                                                      | Source                                                      |
|---------------|------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------|
| Oct 1         | v0.160.0               | "Show more" for older tasks in the agent command center; middle-click paste in fullscreen on Linux X11; sessions outside a project with workspace defaults, saved permissions restored on resume; Guardian review retrieves earlier user instructions and handoff context | [Changelog](https://learn.chatgpt.com/docs/changelog)       |
| Oct 4 – Oct 5 | v0.162.0-alpha.12 … 14 | Alpha builds with no release notes                                                                                                                                                                                                                                        | [GitHub Releases](https://github.com/openai/codex/releases) |

**OpenCode (Oct 4 – Oct 5):**

| Date | Version | News                                               | Source                                                            |
|------|---------|----------------------------------------------------|-------------------------------------------------------------------|
| —    | —       | No release since v1.18.34 (Sep 30, already logged) | [GitHub Releases](https://github.com/anomalyco/opencode/releases) |

**Relevance for Aide:**

- ℹ Codex v0.160.0, Copilot v1.0.92-4 pre-release and the Anthropic training investment — no Aide action.

### 2026-10-04

Sep 30 – Oct 4. **Claude Code got mods** (v2.1.287): plugins can now change deeper behaviour through function hooks
that reload in the session. Claude Code v2.1.288 also fixed path-scoped `.claude/rules` and nested `CLAUDE.md` not
loading for a file created or changed during the session, which the dashboard's own rules rely on. Codex had only
alpha builds after v0.159.3.

**Claude Code (Sep 30 – Oct 4, v2.1.286 → v2.1.289):**

| Date  | Version  | News                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Source                                                                |
|-------|----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------|
| Oct 1 | v2.1.287 | **Claude Mods**: plugins can change deeper behaviour through function hooks that reload in the session (panes, bands, status lines, toasts, hooks); a built-in "You should know" mod; `n:<text>` filter in the agents view; `prompt_text` on the OpenTelemetry `user_prompt` event; `asyncRewake` hooks no longer wake repeatedly when their script is missing                                                                                                            | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 2 | v2.1.288 | Path-scoped `.claude/rules` and nested `CLAUDE.md` now load when a file is created or changed in the session; `-p` sessions stream the turns of a `context: fork` skill; a non-interactive session continues from a partial response after an API timeout; long conversations auto-compact instead of failing "Prompt is too long"; an agent spawned by name runs with its own prompt, tools and effort; `$.ui.selection()` for mods; `--max-findings` for `/code-review` | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 3 | v2.1.289 | `agent.spawn` for teammates and one agent id across plugin hook events; installed mods load in the first session after an upgrade; Read deny rules apply to @-mentioned files reached through symlinks; deny/ask rules on nested compound shell commands hold over mod approvals                                                                                                                                                                                          | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 1 | —        | Blog: "Customize Claude Code with mods"; Sep 25: "Build plugins for Claude", listed in the Claude Marketplace (Sep 23)                                                                                                                                                                                                                                                                                                                                                    | [Claude blog](https://claude.com/blog/)                               |

**GitHub Copilot CLI (Sep 30 – Oct 4, v1.0.89 → v1.0.91, and v1.0.92 pre-releases):**

| Date          | Version              | News                                                                                                                                                                                                    | Source                                                            |
|---------------|----------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| Oct 1         | v1.0.91              | `copilot sandbox ca` commands; review of read-only shell pipelines; telemetry flushed on shutdown; model picker updates                                                                                 | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Oct 1 – Oct 2 | v1.0.92-0 … -3 (pre) | Environment picker (Ctrl+E) for local or cloud runs; remote MCP servers reconnect after their HTTP session expires; background agents can be steered by message; retired models removed from the picker | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Oct 1         | —                    | Dynamic workflows in Copilot CLI and the Copilot app; Copilot can drive desktop apps with computer use; Oct 2: selected models deprecated                                                               | [GitHub Changelog](https://github.blog/changelog/label/copilot/)  |

**OpenAI Codex CLI (Sep 30 – Oct 4, v0.159.2 → v0.159.3):**

| Date           | Version               | News                                                                                                                                                                                                                                                                                                                                                    | Source                                                                                                    |
|----------------|-----------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| Sep 30         | v0.159.3              | Optional account-security setup reminders for local sessions signed in with ChatGPT                                                                                                                                                                                                                                                                     | [Changelog](https://learn.chatgpt.com/docs/changelog)                                                     |
| Sep 30 – Oct 4 | v0.162.0-alpha.3 … 12 | Alpha builds with no release notes                                                                                                                                                                                                                                                                                                                      | [GitHub Releases](https://github.com/openai/codex/releases)                                               |
| —              | —                     | Developer blog: "Rethinking skills and prompts for GPT-6 Astra" — trim instructions written for weaker models, keep skill descriptions short and specific, say when each document in `AGENTS.md` applies, avoid contradicting instructions, and state when a task is done, since GPT-6 models can be tentative about finishing (the post shows no date) | [OpenAI developer blog](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) |

**OpenCode (Sep 30 – Oct 4, v1.18.33 → v1.18.34):**

| Date   | Version  | News                                                                                                | Source                                                            |
|--------|----------|-----------------------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| Sep 30 | v1.18.34 | Namespaced session identity headers on model requests; macOS binaries signed for macOS 27 and later | [GitHub Releases](https://github.com/anomalyco/opencode/releases) |

**Relevance for Aide:**

- ✅ **Claude Code mods** (v2.1.287) — a richer kind of hook than the shell commands Aide installs in `settings.json`
  (the markdownlint check, the `git add .` and watch-mode blocks). No action now; a mod could one day show the
  board's state inside a session.
- ✅ **Path-scoped rules load on file creation and change** (v2.1.288) — the dashboard's `.claude/rules` (landing,
  process groups, design) now load for a file a session creates, not only one it reads.
- ✅ **`-p` streams a forked skill's turns** and **continues after an API timeout** (v2.1.288) — the runner reads
  `stream-json` from `claude -p`, so a skill run with `context: fork` now shows in the step's log, and a timeout
  mid-response no longer ends the turn.
- ✅ **OpenAI's guidance on skills and prompts for GPT-6 models** matches what GPT-6.1 Sol ran into on archive
  (specs 595 and 597): a prompt line that contradicted the archive skill, and a skill that named only one of the two
  worktrees a merge could be open in. Both were fixed in the runner and the skill. Worth reading before the next
  change to a skill: short, specific descriptions, no contradictions, and an explicit end to each task.
- ℹ Claude Code v2.1.286's `--bare` change (the runner does not use `--bare`), v2.1.289's agent and mod fixes,
  "Build plugins for Claude", Copilot v1.0.91 and its v1.0.92 pre-releases, Codex v0.159.3 and its alphas, and
  OpenCode v1.18.34 — no Aide action.

### 2026-09-30

Sep 28 – Sep 30. **GPT-6.1 Sol is Codex's new default model** (v0.159.1), and it is not yet one of the board's model
choices. Claude Sonnet 5.5 became the default Sonnet (Claude Code v2.1.284), which the board's "Sonnet" already
follows. Copilot CLI v1.0.89 made the `.claude/rules` support stable.

**Claude Code (Sep 28 – Sep 30, v2.1.283 → v2.1.286):**

| Date   | Version  | News                                                                                                                                                                                                                                                                                                                                                                       | Source                                                                |
|--------|----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------|
| Sep 28 | v2.1.284 | Claude Sonnet 5.5 (`claude-sonnet-5-5`) added and made the default Sonnet on the Anthropic API — 1M context, $2/$10 per Mtok, $0.20/Mtok cache reads; fixes for damaged response streams and errors after a thinking block now retried; a rule symlinked into `.claude/rules` from outside the project now asks for the external-imports approval instead of being skipped | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Sep 29 | v2.1.285 | `CLAUDE_CODE_DISABLE_WEB_FETCH`; `claude --desktop`; `claude plugin configure`; `allowedProviders` managed setting; in `claude -p`, a forked subagent's Agent call runs in the foreground and a background subagent's permission request reaches `--permission-prompt-tool`                                                                                                | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Sep 30 | v2.1.286 | When the API refuses the model an alias resolves to, Claude Code retries once on the previous model of the same tier; `--resume`/`--continue` no longer lose turns after a batch of parallel tool calls in a crashed session; several secret-redaction fixes in logs and transcripts                                                                                       | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |

**GitHub Copilot CLI (Sep 28 – Sep 30, v1.0.89-5 → v1.0.89, and v1.0.90 pre-releases):**

| Date            | Version        | News                                                                                                                                                                                                                                                | Source                                                            |
|-----------------|----------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| Sep 28          | v1.0.89        | Stable release of the v1.0.89 line: `.claude/rules` support as custom instructions, GPT-6 Sol and Luna in the model picker, Claude Opus 5.5 support, PR creation follows repository pull request templates, Esc Esc takes back an unanswered prompt | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Sep 28 – Sep 30 | v1.0.90-0 … -7 | Pre-releases with no notes beyond "Fixes and changes"                                                                                                                                                                                               | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Sep 28 / 29     | —              | Claude Sonnet 5.5 and GPT-6.1 Sol available in GitHub Copilot                                                                                                                                                                                       | [GitHub Changelog](https://github.blog/changelog/label/copilot/)  |

**OpenAI Codex CLI (Sep 28 – Sep 30, v0.157.1 → v0.159.2):**

| Date   | Version  | News                                                                                                                                                                                                         | Source                                                                                                              |
|--------|----------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| Sep 28 | v0.158.0 | Copy-on-select in the fullscreen TUI; MCP servers with pre-registered OAuth client secrets; bearer tokens for exec-server WebSocket connections; terminal input approval on by default for elevated commands | [GitHub Releases](https://github.com/openai/codex/releases)                                                         |
| Sep 29 | v0.159.0 | Opt-in `instant_interrupt`; compact welcome screen; `.aws` protected under writable roots; the `tui.prompt_suggestions` setting and the bundled `plugin-creator` skill removed                               | [GitHub Releases](https://github.com/openai/codex/releases)                                                         |
| Sep 29 | v0.159.1 | **GPT-6.1 Sol is the default model** in the bundled catalog and the Amazon Bedrock catalogs — "near-Astra performance for complex work at a lower cost than Astra"                                           | [GitHub Releases](https://github.com/openai/codex/releases) · [Changelog](https://learn.chatgpt.com/docs/changelog) |
| Sep 29 | v0.159.2 | Windows console windows no longer flash for background and sandboxed commands                                                                                                                                | [GitHub Releases](https://github.com/openai/codex/releases)                                                         |

**OpenCode (Sep 28 – Sep 30):**

| Date | Version | News                                                   | Source                                                            |
|------|---------|--------------------------------------------------------|-------------------------------------------------------------------|
| —    | —       | No new release since v1.18.33 (Sep 28, already logged) | [GitHub Releases](https://github.com/anomalyco/opencode/releases) |

**Relevance for Aide:**

- ⭐ **GPT-6.1 Sol is Codex's default model** — added to the board's `modelChoices` as `gpt-6.1-sol` (it answered
  `codex exec -m` on 0.159.0, already on the serving host). A Codex step with no model named now runs on it.
- ✅ **Claude Sonnet 5.5 is the default Sonnet** — no change: the board's "Sonnet" names the `sonnet` alias, and the
  runs since Sep 28 already report `claude-sonnet-5-5`.
- ✅ **Claude Code v2.1.286 retries once on the previous model of the same tier** when an alias's model is refused — an
  unattended step no longer fails outright on such a refusal.
- ✅ **Copilot CLI v1.0.89 is stable** with the `.claude/rules` support 556 recorded in the matrix; the matrix's
  version stamp picks it up at the next `scripts/stamp-versions`.
- ℹ Claude Code v2.1.285's `claude -p` subagent and permission-prompt fixes, Codex's `instant_interrupt` and removed
  `plugin-creator` skill, and Copilot's v1.0.90 pre-releases — no Aide action.

### 2026-09-28

Sep 26 – Sep 28. No new Claude Code or stable Codex CLI release. The one finding that matters for Aide: **Copilot CLI
v1.0.89-5 adds `.claude/rules` support**, confirming the row `docs/AI_SUPPORT_MATRIX.md` has carried as unverified.

**Claude Code (Sep 26 – Sep 28):**

| Date | Version | News                                                   | Source                                                                |
|------|---------|--------------------------------------------------------|-----------------------------------------------------------------------|
| —    | —       | No new release since v2.1.283 (Sep 25, already logged) | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |

**GitHub Copilot CLI (Sep 27, v1.0.89-4 → v1.0.89-5):**

| Date   | Version   | News                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Source                                                            |
|--------|-----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| Sep 27 | v1.0.89-5 | Add support for Claude Code rule files in `.claude/rules` as custom instructions; ask_user/elicitation form inputs focus on left-click; sessions sidebar shows a blue dot for an unopened finished turn; extensions no longer fail to load while managed MCP policy is still applying; fixed Git failures in apps launched from CLI shells with empty environment variables dropped (Git 2.36+); sessions sidebar saves opened/closed tabs as they change; sandboxed agent shell commands can access session files and logs | [GitHub Releases](https://github.com/github/copilot-cli/releases) |

**OpenAI Codex CLI (Sep 26 – Sep 28):**

| Date | Version | News                                                                                                                   | Source                                                      |
|------|---------|------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------|
| —    | —       | No new stable release since v0.157.1 (Sep 26, already logged); only 0.158.0/0.159.0 alpha builds with no release notes | [GitHub Releases](https://github.com/openai/codex/releases) |

**OpenCode (Sep 28, v1.18.32 → v1.18.33):**

| Date   | Version  | News                                                                                                                                                                                                                                                                                                                                | Source                                                            |
|--------|----------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| Sep 28 | v1.18.33 | Cloudflare AI Gateway models now honor provider response and stream timeouts; MCP browser launch failures reported when the launcher exits immediately; debug configuration output redacts credentials and sensitive headers; Gemini thinking defaults and effort options now match the supported controls across model generations | [GitHub Releases](https://github.com/anomalyco/opencode/releases) |

**Relevance for Aide:**

- ⭐ **Copilot CLI v1.0.89-5 adds `.claude/rules` support** — confirms the row `docs/AI_SUPPORT_MATRIX.md` carried as
  unverified; see the separate spec proposing the matrix update.
- ℹ Codex 0.158.0/0.159.0 alphas, OpenCode v1.18.33, and Copilot's other v1.0.89-5 items — no Aide action.

### 2026-09-26

Sep 21 – Sep 26, from the scheduled Nyhetssjekk run's report, with OpenCode added by hand (the report's sources did not
include it yet). New models across the tools; nothing that changes how Aide installs or runs. Three proposals from
2026-09-21 were never followed up and are carried over below.

**Claude Code (Sep 22 – Sep 25, v2.1.280 → v2.1.283):**

| Date   | Version  | News                                                                                                                                                                                                          | Source                                                                |
|--------|----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------|
| Sep 22 | —        | Claude Opus 5.5: comparable to Fable 5.1 at 40% lower cost                                                                                                                                                    | [Anthropic news](https://www.anthropic.com/news)                      |
| Sep 25 | v2.1.283 | Opt-in gateway hint header `x-claude-code-prompt-id` (`CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`); managed settings `availableModelsMatch` and `deniedModels`; MCP tool output saved to files; faster first request | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |

Versions v2.1.280–282 were not itemised on the releases page.

**GitHub Copilot CLI (Sep 21 – Sep 25, v1.0.87 → v1.0.89-4):**

| Date   | Version         | News                                                                                                    | Source                                                            |
|--------|-----------------|---------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| Sep 21 | v1.0.87         | Auto routing tier startup defaults with policy; `worktreePathTemplate` setting; Windows sandbox proxy   | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Sep 22 | v1.0.88         | OSC 777 notifications; managed settings apply to ACP and AHP modes; MCP indexed search with glob filter | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Sep 22 | v1.0.89-0 (pre) | Claude Opus 5.5 support                                                                                 | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Sep 23 | v1.0.89-1 (pre) | GPT-6 Sol and Luna support                                                                              | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Sep 25 | v1.0.89-4 (pre) | Auto suggests a routing tier; direct plugin installs can be enabled and disabled                        | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Sep 21 | —               | Grok 4.7 available in Copilot                                                                           | [GitHub Blog](https://github.blog/changelog/label/copilot/)       |

**OpenAI Codex CLI (Sep 22 – Sep 26, v0.156.0 → v0.157.1):**

| Date   | Version  | News                                                                                                                  | Source                                                      |
|--------|----------|-----------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------|
| Sep 22 | v0.156.0 | Optional fullscreen UI, voice conversations by default, `/usage` dashboard; GPT-6 Sol and Luna rolled out to Codex    | [Codex changelog](https://learn.chatgpt.com/docs/changelog) |
| Sep 25 | v0.157.0 | GPT-6 Sol/Luna on Amazon Bedrock; fullscreen transcripts by default; background server starts in interactive sessions | [GitHub](https://github.com/openai/codex/releases)          |

**OpenCode (Sep 14 – Sep 21, v1.18.31 → v1.18.32):**

| Date   | Version  | News                                                                                                        | Source                                                            |
|--------|----------|-------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| Sep 14 | v1.18.31 | ACP sessions keep their model, effort and mode on resume and fork; remote config auth errors fail startup   | [GitHub Releases](https://github.com/anomalyco/opencode/releases) |
| Sep 21 | v1.18.32 | Bedrock image attachments fixed; Together AI usage reporting fixed; Grok 4.7 and DeepSeek V4.1 Flash in Zen | [GitHub Releases](https://github.com/anomalyco/opencode/releases) |

**Relevance for Aide:**

- ⭐ **GPT-6 Sol and Luna in Codex** — added to the board's `modelChoices` as `gpt-6-sol` and `gpt-6-luna` (both answered
  `codex exec -m` on 0.157.1).
- ✅ **Claude Opus 5.5** — no change: the board's "Opus" names the `opus` alias, which follows the newest Opus.
- ℹ **Codex 0.157's background server** starts in interactive sessions only; the runner uses `codex exec`.
- ℹ **Claude Code `deniedModels`/`availableModelsMatch`** apply to organisation-managed settings, which Aide does not use.
- ℹ **Copilot `worktreePathTemplate`, plugin toggles, MCP indexing** — the runner does not drive Copilot; no Aide action.
- ⚠️ **GPT-5.5 retires Oct 14** (from 2026-09-21) — done: `gpt-5.5` is out of the board's `modelChoices`; no default,
  schedule or queued job named it.

**Carried over from 2026-09-21, awaiting approval:**

- Done: `.claude/skills/ai-tools-reference/SKILL.md` notes that Claude Code reads `AGENTS.md` when a project has no
  `CLAUDE.md` (v2.1.277; not on Bedrock/Vertex/Foundry).
- Done: `.claude/skills/ai-tools-reference/SKILL.md` lists `syncClaudeAiSkills`/`syncClaudeAiPlugins` among Claude Code's
  configuration files (v2.1.275).
- Declined: `include-custom-instructions` for Copilot's custom agents is not added to `docs/AI_SUPPORT_MATRIX.md`. It
  could not be verified on 1.0.88 without a live run, and the runner does not drive Copilot.
- Done here: the Codex changelog address is now `learn.chatgpt.com/docs/changelog` in the Sources table and in the
  check-news skill.

---

### 2026-09-21

Short period (Sep 14 – Sep 21). The one finding that matters for Aide: **Claude Code v2.1.277 reads `AGENTS.md` in projects without a `CLAUDE.md`**. The Codex changelog has moved from `developers.openai.com/codex/changelog/` to `learn.chatgpt.com/docs/changelog` (a permanent redirect).

**Claude Code (Sep 17 – Sep 19, v2.1.271 → v2.1.278):**

| Date   | Version  | News                                                                                                                                                                                       | Source                                                                |
|--------|----------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------|
| Sep 17 | v2.1.275 | `ctrl+enter` interrupts the turn and sends queued messages; skills and plugins enabled on claude.ai sync to terminal sessions (`syncClaudeAiSkills`/`syncClaudeAiPlugins: false` opts out) | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Sep 18 | v2.1.276 | Fixed every request failing with `400 … advisor_20260301` behind a proxy or gateway (2.1.275 regression)                                                                                   | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Sep 18 | v2.1.277 | **Reads `AGENTS.md` in projects without `CLAUDE.md`** (not yet on Bedrock/Vertex/Foundry); `CLAUDE_GATEWAY_PROXY_IS_EGRESS_BOUNDARY=1`; `headers:` map on gateway upstreams                | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Sep 19 | v2.1.278 | Auto mode defaults to a server-side classifier for Claude API and Enterprise users (`CLAUDE_CODE_AUTO_MODE_SERVER=0` opts out); `/status` shows where the classifier runs                  | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |

Versions v2.1.271–274 were not itemised on the releases page.

**GitHub Copilot CLI (Sep 16 – Sep 18, v1.0.85 → v1.0.87-0):**

| Date   | Version         | News                                                                                                                                                                           | Source                                                            |
|--------|-----------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| Sep 16 | v1.0.85         | Vim mode for everyone; `transcriptView: "concise"`; `enable`/`disable` on `plugin`, `mcp` and `skill` commands; `copilot instruction list` and `copilot lsp list`; GPT-6 Astra | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Sep 17 | v1.0.86         | Custom agents can opt into repo instruction files with `include-custom-instructions: true`; session resume keeps marketplace plugins and skills                                | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Sep 18 | v1.0.87-0 (pre) | Auto routing tier with org policy; `worktreePathTemplate` setting; configurable MCP slow-connection warning                                                                    | [GitHub Releases](https://github.com/github/copilot-cli/releases) |

**GitHub Copilot Platform (Sep 14–18):**

| Date   | News                                                               | Source                                                      |
|--------|--------------------------------------------------------------------|-------------------------------------------------------------|
| Sep 14 | Cost and quality configurable in Copilot auto model selection      | [GitHub Blog](https://github.blog/changelog/label/copilot/) |
| Sep 17 | Agentic CLI customizations available through the usage metrics API | [GitHub Blog](https://github.blog/changelog/label/copilot/) |
| Sep 18 | Selected Copilot models are phased out in mid-October              | [GitHub Blog](https://github.blog/changelog/label/copilot/) |

**OpenAI Codex CLI (Sep 17 – Sep 18, v0.155.0 → v0.155.1):**

| Date   | Version  | News                                                                                                                                                       | Source                                                      |
|--------|----------|------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------|
| Sep 14 | —        | GPT-5.3-Codex-Spark deprecated; GPT-5.5 retires Oct 14 (switch to GPT-5.6-Sol)                                                                             | [Codex changelog](https://learn.chatgpt.com/docs/changelog) |
| Sep 17 | v0.155.0 | Experimental voice conversations; Touch ID verification for MCP requests on macOS; configurable daemon updates; AWS credential handling for Amazon Bedrock | [Codex changelog](https://learn.chatgpt.com/docs/changelog) |
| Sep 18 | v0.155.1 | New local TUI sessions leave reasoning summaries off by default (fixes rejections by providers that do not support them)                                   | [GitHub](https://github.com/openai/codex/releases)          |

The 0.156.0 alphas (Sep 19–21) carry no release notes.

**Relevance for Aide:**

- ⭐ **Claude Code reads `AGENTS.md` when a project has no `CLAUDE.md` (v2.1.277)** — a project where Aide's Codex-side instructions live in `AGENTS.md` alone now also reaches Claude Code. Verify the installer's handling of a project with `AGENTS.md` and no `CLAUDE.md` before relying on it. Proposed: in `.claude/skills/ai-tools-reference/SKILL.md`, note under Claude Code's instruction files that `AGENTS.md` is a fallback when `CLAUDE.md` is absent (not on Bedrock/Vertex/Foundry).
- ✅ **Claude Code syncs claude.ai skills and plugins to the terminal (v2.1.275)** — skills enabled on claude.ai can now appear next to Aide's; opt out with `syncClaudeAiSkills: false`. Proposed: in `.claude/skills/ai-tools-reference/SKILL.md`, list the two settings under skill discovery.
- ✅ **Copilot CLI `enable`/`disable` on `plugin`, `mcp`, `skill` (v1.0.85) and `include-custom-instructions` for custom agents (v1.0.86)** — logged for the next verification sweep. Proposed: in `docs/AI_SUPPORT_MATRIX.md`, add `include-custom-instructions` to the Copilot agents row after verifying it on the installed 1.0.86.
- ✅ **Auto mode server-side classifier (Claude Code v2.1.278)** — no effect on the queue, which passes `--permission-mode` per step.
- ⚠️ **Codex changelog URL moved to `learn.chatgpt.com/docs/changelog` (permanent redirect)** — Proposed: in `docs/AI_NEWS_LOG.md` (Sources) and `.claude/skills/check-news/SKILL.md`, replace the old URL; that is a source list, not the matrix or reference, so it is left for a user to approve.
- ℹ **Codex 0.155 voice, Touch ID for MCP, Bedrock credentials; Copilot Vim mode, auto routing, model phase-out; GPT-5.5 retirement Oct 14** — no Aide action; Aide's `modelChoices` should not name GPT-5.5 or GPT-5.3-Codex-Spark.

---

### 2026-09-14

Long period (May 23 – Sep 14, ~16 weeks; the log had not been run since May). Three Anthropic model launches, each becoming a Claude Code default: **Sonnet 5** (Jun 30), **Opus 5** (Jul 24), **Fable 5.1** (Sep 1). OpenAI shipped **GPT-6 Astra** as Codex's bundled default. For Aide the two findings that matter: **`codex exec resume <thread-id> [prompt] --json` exists** (since v0.132, verified on the installed 0.154.0), and Claude Code's **`--permission-prompts none`** for unattended `-p` hosts.

**Claude Code (May 23 – Sep 12, v2.1.150 → v2.1.270):**

| Date   | Version  | News                                                                                                                                                                                              | Source                                                                |
|--------|----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------|
| Jun 15 | v2.1.178 | **Skills in nested `.claude/skills` directories load when working on files there** (`<dir>:<name>` on a clash); `Tool(param:value)` permission rules                                              | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Jun 26 | v2.1.195 | ⚠️ **Hook matchers now exact-match** — hyphenated identifiers (`code-reviewer`, `mcp__brave-search`) no longer substring-match; use `mcp__x__.*` for all                                          | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Jun 30 | v2.1.197 | **Claude Sonnet 5 is the default model**, native 1M context, $2/$10 per Mtok promo through Aug 31                                                                                                 | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Jul 1  | v2.1.198 | Subagents run in the background by default; `Notification` hook fires `agent_needs_input`/`agent_completed`; Explore agent inherits the main model                                                | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Jul 15 | v2.1.211 | `--forward-subagent-text` / `CLAUDE_CODE_FORWARD_SUBAGENT_TEXT` puts subagent text into stream-json; a PreToolUse hook `ask` now floors auto mode at a prompt                                     | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Jul 19 | v2.1.215 | **`/verify` and `/code-review` are no longer run on Claude's own initiative** — invoke them explicitly                                                                                            | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Jul 24 | v2.1.219 | **Claude Opus 5 (`claude-opus-5`) is the default Opus**; `DirectoryAdded` hook; `mcp_server_errors` in the headless init event                                                                    | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Aug 13 | v2.1.232 | Subagent forking on by default (`subagent_type: "fork"`); `@`-mention another session; `additionalMarketplaces`/`allowedMarketplaces` settings aliases                                            | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Aug 14 | v2.1.233 | Fixed bundled skill aliases (`/review`, `/checkup`) reporting "Unknown command" in `-p` mode when a project skill shadows them; skill argument re-expansion fixed                                 | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Aug 28 | v2.1.251 | `PreModelSwitch`/`PostModelSwitch` hook events; `SessionStart` resume hooks get staleness and re-cache cost; prompt-cache line in `/cost`                                                         | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Sep 1  | v2.1.257 | **Claude Fable 5.1 (`claude-fable-5-1`) is the default Fable**, 1M context, $10/$50 per Mtok; ⚠️ `defaultMode: "bypassPermissions"` in a project's `.claude/settings.json` is now ignored         | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Sep 2  | v2.1.259 | ⭐ **`--permission-prompts none` for unattended headless hosts** (anything that would prompt is denied, the permission mode keeps deciding); `managedMcpServers`; `claude plugin validate --json` | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Sep 4  | v2.1.261 | **`/skill-doctor`** shows unused loaded skills and their context cost; `bashOutputMaxChars`/`taskOutputMaxChars` (up to 128K); `--append-subagent-system-prompt-file`                             | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Sep 9  | v2.1.267 | `maxEffortLevel` setting; `-p --resume` after `/compact` no longer inserts a spurious turn; `cd` persists across turns in non-interactive sessions                                                | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Sep 11 | v2.1.269 | **`claude plugin eval`** scores a plugin's eval suite (JSON + HTML report); `/output-style` in headless sessions; `bashEditDiffEnabled`                                                           | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Sep 12 | v2.1.270 | ⭐ Fixed read-only git commands in Bash unexpectedly asking for permission after a session had been running for a while (regression in 2.1.269)                                                   | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |

**GitHub Copilot CLI (May 28 – Sep 11, v1.0.55 → v1.0.84-5):**

| Date   | Version         | News                                                                                                                                                                                              | Source                                                            |
|--------|-----------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| Jun 9  | v1.0.61         | Auto-loads MCP servers from `.github/mcp.json`; Claude Fable 5 support                                                                                                                            | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Jun 24 | v1.0.65         | **`copilot skill` subcommand** (list/add/remove skills from a file, URL or directory); `userPromptSubmitted` hook `additionalContext` reaches the prompt                                          | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Jul 10 | v1.0.70         | **`preToolUse` hooks exiting 2 deny the call**; `--sandbox`/`--no-sandbox` per session (useful with `-p`); a trusted repo can pin model/effort and deny lists via `.github/copilot/settings.json` | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Jul 16 | v1.0.71         | `copilot -p --autopilot` honours `COPILOT_TASK_WAIT_TIMEOUT_SECONDS`; invalid `settings.json` warns on startup                                                                                    | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Jul 20 | v1.0.72         | `agentStop` hooks that always block end the turn after 8 blocks (`stop_hook_active` flag)                                                                                                         | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Jul 23 | v1.0.74         | **Open Plugin Spec v1 manifests and `mcp.json`** supported                                                                                                                                        | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Aug 3  | v1.0.78         | A stdin-piped run fires `sessionEnd` once per turn like `-p`; first-party plugins auto-update at session start                                                                                    | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Aug 27 | v1.0.81         | **Plugins dashboard for everyone** (`/plugin`, `/mcp`, `/skills`); MCP 2026-07-28 protocol; hooks receive OpenTelemetry trace context                                                             | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Sep 4  | v1.0.83–84      | Custom agents list several `model`s with fallback; `claude-fable-5.1`; GPT-6 Astra; `copilot instruction list` and `--json` on several commands (1.0.84-4)                                        | [GitHub Releases](https://github.com/github/copilot-cli/releases) |
| Sep 11 | v1.0.84-5 (pre) | Shell completions generated from the CLI's own parser grammar; subagent launches honor explicit `model`, reasoning-effort and context-tier preferences                                            | [GitHub Releases](https://github.com/github/copilot-cli/releases) |

**GitHub Copilot Platform (Sep 1–11):**

| Date  | News                                                                                         | Source                                                      |
|-------|----------------------------------------------------------------------------------------------|-------------------------------------------------------------|
| Sep 1 | Copilot code review can approve pull requests                                                | [GitHub Blog](https://github.blog/changelog/label/copilot/) |
| Sep 2 | Content exclusions GA in the Copilot app and CLI; enterprise-managed settings take any model | [GitHub Blog](https://github.blog/changelog/label/copilot/) |
| Sep 9 | Enterprise-managed permissions for Copilot agent operations                                  | [GitHub Blog](https://github.blog/changelog/label/copilot/) |

**OpenAI Codex CLI (May 26 – Sep 9, v0.134 → v0.154):**

| Date   | Version  | News                                                                                                                                                                         | Source                                             |
|--------|----------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------|
| May 26 | v0.134.0 | Search across local conversation history; `--profile` is the primary profile selector                                                                                        | [GitHub](https://github.com/openai/codex/releases) |
| Jun 18 | v0.141.0 | **Hook trust bypass persists through `codex exec` thread start and resume**; blocking `PostToolUse` hooks reject code-mode calls                                             | [GitHub](https://github.com/openai/codex/releases) |
| Jun 22 | v0.142.0 | **Configurable rollout token budgets** across agent threads, with reminders and abort when exhausted                                                                         | [GitHub](https://github.com/openai/codex/releases) |
| Jul 21 | v0.145.0 | **`/import` migrates Claude Code settings, MCP servers, plugins, sessions, commands and memories**; paginated thread history with efficient resume                           | [GitHub](https://github.com/openai/codex/releases) |
| Aug 7  | v0.147.0 | Import Cursor-managed skills; opt-in MCP 2026-07-28 protocol                                                                                                                 | [GitHub](https://github.com/openai/codex/releases) |
| Aug 18 | v0.148.0 | **`codex exec fork`**; **hooks can run asynchronously and invoke MCP tools**; resumed sessions restore cwd and approval policy                                               | [GitHub](https://github.com/openai/codex/releases) |
| Aug 20 | v0.149.0 | `codex agents` dashboard; `codex queue` sends messages to existing sessions; resumed threads restore their permission profile                                                | [GitHub](https://github.com/openai/codex/releases) |
| Aug 26 | v0.150.0 | **`Interrupt` hooks**; ⚠️ **untrusted projects no longer get project-level `AGENTS.md`**                                                                                     | [GitHub](https://github.com/openai/codex/releases) |
| Sep 1  | v0.152.0 | `codex exec` shows credential-refresh progress; per-tool MCP `output_token_limit`; resumed threads restore their saved cwd                                                   | [GitHub](https://github.com/openai/codex/releases) |
| Sep 4  | v0.153.4 | **GPT-6 Astra is the bundled default model** when none is configured                                                                                                         | [GitHub](https://github.com/openai/codex/releases) |
| Sep 9  | v0.154.0 | Experimental `--worktree` / `/worktree` isolated checkouts; sessions pick up newly installed plugin tools, skills and hooks; Python SDK 0.154 `include_turns` on resume/fork | [GitHub](https://github.com/openai/codex/releases) |

Verified on the installed 0.154.0: `codex exec resume [SESSION_ID] [PROMPT]` takes `--json`, `-m`, `--dangerously-bypass-approvals-and-sandbox` and `--output-schema`, and the id is the `thread_id` the runner already reads from `thread.started`.

**Python SDK 0.154.0 (Sep 10):** `max`/`ultra` reasoning-effort values, `ExternalMessage` support for sync/async calls, `include_turns` on resume/fork with per-turn `service_tier`. Aide drives the CLI, not this SDK — informative only.

**New models:**

| Date   | Model                | Details                                                                        | Source                                                                |
|--------|----------------------|--------------------------------------------------------------------------------|-----------------------------------------------------------------------|
| Jun 30 | **Claude Sonnet 5**  | Claude Code default (v2.1.197), 1M context; Copilot CLI v1.0.67                | [GitHub Releases](https://github.com/anthropics/claude-code/releases) |
| Jul 10 | **GPT-5.6**          | Copilot CLI v1.0.70                                                            | [GitHub Releases](https://github.com/github/copilot-cli/releases)     |
| Jul 24 | **Claude Opus 5**    | Claude Code default Opus (v2.1.219), 1M context, fast mode $10/$50 per Mtok    | [Anthropic](https://www.anthropic.com/news)                           |
| Sep 1  | **Claude Fable 5.1** | Claude Code default Fable (v2.1.257), $10/$50 per Mtok, $0.25/Mtok cache reads | [Anthropic](https://www.anthropic.com/news)                           |
| Sep 4  | **GPT-6 Astra**      | Codex bundled default (v0.153.4); Copilot CLI v1.0.84-1                        | [GitHub](https://github.com/openai/codex/releases)                    |

**Relevance for Aide:**

- ⭐ **`codex exec resume <thread-id> [prompt] --json` (Codex, since v0.132; verified on 0.154.0)** — the runner's red-test loop (`run-spec/turn/step-tests.sh`) ends a Codex step at once on the claim that Codex has no resume. It has one, and the runner already keeps the thread id. Action: resume Codex the same way claude is resumed; fix the sentence in `run-spec/setup/invocation.sh`, `dashboard/docs/spec-lifecycle.md` and `dashboard/CLAUDE.md`.
- ⭐ **`--permission-prompts none` (Claude Code v2.1.259)** — `aide-run-spec` runs `claude -p --permission-mode <mode>`; a prompt that can never be answered on a headless host now has an explicit off switch. Verified 2026-09-14 on 2.1.270: identical to `-p`'s default, which already denies such a prompt — left out of the argv on purpose.
- ⚠️ **Hook matchers exact-match (Claude Code v2.1.195)** — verified 2026-09-14: Aide's matchers (`Edit|Write`, `Bash`, `""`) name whole tools; nothing relied on substring matching.
- ⚠️ **`defaultMode: "bypassPermissions"` in a project's `.claude/settings.json` is ignored (v2.1.257)** — verified 2026-09-14: Aide installs `defaultMode: "default"` at user scope only; nothing sets it at project scope. This repo's own `.claude/settings.json` set it to no effect and has been removed; the queue passes `--permission-mode` per step and the user-scope settings decide the rest.
- ⚠️ **Untrusted projects get no project `AGENTS.md` (Codex v0.150)** — verified 2026-09-14: Aide's instructions are the global `~/.codex/AGENTS.md`, which trust does not gate, and Aide ships no project `AGENTS.md`. The serving host's `~/.codex/config.toml` still trusts the old checkout paths (`~/aide-dashboard-checkouts/…`), not `~/.aide/dashboard/checkouts/…` — only matters for a project with its own `AGENTS.md`.
- ⭐ **Three new default models** — `modelChoices` in the queue config, the README's model table and `docs/AI_SUPPORT_MATRIX.md` should name Sonnet 5, Opus 5, Fable 5.1 and GPT-6 Astra where they still name the 4.x/5.0 generation.
- ✅ **`/skill-doctor` (v2.1.261) and `claude plugin eval` (v2.1.269)** — a way to measure what Aide's skills cost in context and whether they are used; worth one run.
- ✅ **Codex hooks run async and call MCP tools (v0.148), `Interrupt` hooks (v0.150), hook trust persists through `codex exec` resume (v0.141)** — the Codex hook implementation can grow; the trust flag matters for the resume above.
- ✅ **Codex `/import` migrates Claude Code settings, skills and memories (v0.145, v0.147)** — an alternative to Aide's own Codex installer for the parts that overlap; not adopted, noted.
- ✅ **Copilot `copilot skill` subcommand, plugins dashboard, Open Plugin Spec v1, `preToolUse` exit 2 denies** — logged for the next verification sweep.
- ℹ **Codex `--worktree`, `codex agents`, `codex queue`; Claude Code cross-session messaging and background subagents by default** — product expansions, no Aide action.

---
