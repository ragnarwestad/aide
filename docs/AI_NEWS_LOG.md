# AI Dev Tools — News Log

## Table of contents

- [Maintenance](#maintenance)
  - [Sources](#sources)
  - [Watched pages](#watched-pages)
- [Notation](#notation)
- [News log](#news-log)
  - [2026-10-31](#2026-10-31)
  - [2026-10-30](#2026-10-30)
  - [2026-10-29](#2026-10-29)
  - [2026-10-28](#2026-10-28)
  - [2026-10-27](#2026-10-27)
  - [2026-10-26](#2026-10-26)
  - [2026-10-25](#2026-10-25)
  - [2026-10-24](#2026-10-24)
  - [2026-10-23](#2026-10-23)
  - [2026-10-19](#2026-10-19)
  - [2026-10-12](#2026-10-12)
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

| Tool               | Changelog                                                                                          | News                                                                                                      |
|--------------------|----------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| Claude Code        | <https://github.com/anthropics/claude-code/releases>                                               | <https://claude.com/blog/><br><https://claude.com/resources/articles><br><https://www.anthropic.com/news> |
| GitHub Copilot CLI | <https://github.com/github/copilot-cli/releases><br><https://github.blog/changelog/label/copilot/> | <https://github.blog/ai-and-ml/github-copilot/>                                                           |
| OpenAI Codex CLI   | <https://github.com/openai/codex/releases><br><https://learn.chatgpt.com/docs/changelog>           | <https://developers.openai.com/blog>                                                                      |
| OpenCode           | <https://github.com/anomalyco/opencode/releases><br><https://opencode.ai/changelog>                | —                                                                                                         |
| All four           | —                                                                                                  | <https://artificialanalysis.ai/agents/coding-agents>                                                      |

### Watched pages

The best-practice pages the skill fetches on every run and compares with the copy kept from the previous
run. They change without an announcement, so none of the sources above shows it. This table is the one list of
watched pages: a page is added or removed here. A pattern in the third column adds every link on that page matching
it, so a page that lists one page per model brings each new model's page in by itself. `scripts/watch-pages.py`
reads the table, and keeps the copies in `~/.aide/news-check/watched-pages/` and each change's diff in
`~/.aide/news-check/watched-diffs/`, on the machine that runs the news check, outside the repository.

| Tool               | Page                                                                                                       | Also its links to                                                                             |
|--------------------|------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| Claude Code        | <https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices>                         |                                                                                               |
| Claude Code        | <https://code.claude.com/docs/en/best-practices>                                                           |                                                                                               |
| Claude Code        | <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices> | <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-*> |
| Claude Code        | <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>                        |                                                                                               |
| Claude Code        | <https://www.anthropic.com/engineering/building-effective-agents>                                          |                                                                                               |
| Claude Code        | <https://www.anthropic.com/engineering/writing-tools-for-agents>                                           |                                                                                               |
| Claude Code        | <https://code.claude.com/docs/en/hooks-guide>                                                              |                                                                                               |
| OpenAI Codex CLI   | <https://developers.openai.com/codex/learn/best-practices>                                                 |                                                                                               |
| OpenAI Codex CLI   | <https://developers.openai.com/codex/guides/agents-md>                                                     |                                                                                               |
| OpenAI Codex CLI   | <https://learn.chatgpt.com/docs/build-skills>                                                              |                                                                                               |
| OpenAI Codex CLI   | <https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide>                              |                                                                                               |
| GitHub Copilot CLI | <https://docs.github.com/en/copilot/tutorials/cloud-agent/get-the-best-results>                            |                                                                                               |
| GitHub Copilot CLI | <https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions>     |                                                                                               |
| GitHub Copilot CLI | <https://docs.github.com/en/copilot/concepts/customizations/agent-skills>                                  |                                                                                               |
| OpenCode           | <https://opencode.ai/docs/rules>                                                                           |                                                                                               |
| OpenCode           | <https://opencode.ai/docs/skills>                                                                          |                                                                                               |
| OpenCode           | <https://opencode.ai/docs/agents>                                                                          |                                                                                               |
| All four           | <https://agentskills.io/specification>                                                                     |                                                                                               |
| All four           | <https://agents.md>                                                                                        |                                                                                               |

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

### 2026-10-31

Oct 30 – Oct 31. Not read: Claude Code v2.1.315 (the releases page skips it and its tag page answers 404), the Codex
changelog page past its first 100,000 characters, the OpenCode changelog page past its first 100,000 characters, the
OpenAI developer blog (no dates shown), Artificial Analysis (the harness comparison there is still "coming soon"), the
GitHub Copilot blog (newest post shown is Oct 20), the Copilot changelog (titles only, newest Oct 28). The X list digest
of Oct 31 says the list could not be read (the machine's Chrome was not connected), and so did the one of Oct 30. Of the
watched pages, none changed in what it advises: the Claude Code best-practices page added "Ultra" to the plans that
show `/usage` by skill, subagent, plugin and MCP server; the Claude prompting page changed in whitespace only;
`agents.md` changed in star counts.

**Claude Code (v2.1.316):**

| Date   | Version  | News                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Source                                                         |
|--------|----------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------|
| Oct 31 | v2.1.316 | New `CLAUDE_CODE_SUBAGENT_EFFORT` sets the effort subagents run at when nothing else names one, instead of inheriting the session's; new `CLAUDE_CODE_DISABLE_ULTRATHINK` turns the `ultrathink` keyword off; fast mode for Opus 4.8 is deprecated as of Oct 30 and removed Nov 30, after which a fast-mode request on Opus 4.8 returns an error and does not fall back (migrate to Opus 5.5); server-managed settings for Team and Enterprise logins now apply without an approval prompt; an `autoMode.allow` list without `"$defaults"` no longer removes the built-in rule on scheduled-task prompts; fixed sub-agents that inherited a parent sub-agent's model moving to the main model when a background job woke them; fixed `--restricted` sessions uploading files from outside the working directories; fixed shell commands left running when Claude Code exits by itself; fixed bash scripts stopping after their first command when `SHELLOPTS` is exported; Claude apps gateway pooled group budgets and `managed.policy_mode: layered` | [Releases](https://github.com/anthropics/claude-code/releases) |

**GitHub Copilot CLI (v1.0.105, no newer release):**

| Date | Version | News                                       | Source                                                     |
|------|---------|--------------------------------------------|------------------------------------------------------------|
| —    | —       | No release or changelog entry after Oct 28 | [Releases](https://github.com/github/copilot-cli/releases) |

**OpenAI Codex CLI (v0.166.0, no newer release):**

| Date | Version | News                                                   | Source                                               |
|------|---------|--------------------------------------------------------|------------------------------------------------------|
| —    | —       | No release or changelog entry after v0.166.0 of Oct 29 | [Releases](https://github.com/openai/codex/releases) |

**OpenCode (v2.2.5):**

| Date   | Version | News                                                                                                                                                                                                                                                                                                                           | Source                                                     |
|--------|---------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------|
| Oct 30 | v2.2.3  | Built-in Claude Agent provider that uses your Claude Code login, picked in `/connect` (`OPENCODE_CLAUDE_PATH` overrides the executable); breaking: TUI plugins need OpenTUI 0.8 or later; breaking: in managed policy `integration.use` now covers integrations only, with new `mcp.use`, `skill.use` and `plugin.use` actions | [Releases](https://github.com/anomalyco/opencode/releases) |
| Oct 30 | v2.2.4  | Opt-in artifacts (`"experimental": { "artifacts": true }`) let agents publish and serve HTML or static files; guided Claude Agent setup in the provider picker; schedules run under `opencode serve` and fire once across processes; config can override Console-supplied provider settings                                    | [Releases](https://github.com/anomalyco/opencode/releases) |
| Oct 30 | v2.2.5  | `compaction.buffer` accepts a percentage such as `"20%"`; calls to a tool named `bash` now run as `shell`; large MCP stdio messages no longer disconnect servers; compaction capped to the context window; worktree and base-branch shortcuts                                                                                  | [Releases](https://github.com/anomalyco/opencode/releases) |

**Relevance for aide:**

- ⭐ Claude Code v2.1.316: new `CLAUDE_CODE_SUBAGENT_EFFORT` sets the effort subagents run at, instead of inheriting the
  session's. Aide's steps start `claude -p` at the effort their job named and spawn subagents, which inherit that
  effort today; the Oct 29 digest (@bcherny) named that inheritance as a main cause of fast token use. The runner can now
  set a lower subagent effort per step. [Release](https://github.com/anthropics/claude-code/releases)
- ⚠️ Claude Code v2.1.316: fast mode for Opus 4.8 is deprecated as of Oct 30 and removed Nov 30; after that a fast-mode
  request on Opus 4.8 returns an error with no fallback. Aide offers `claude-opus-4-8` as a fixed model choice, so check that no step or queue config relies on fast mode with that model.
  [Release](https://github.com/anthropics/claude-code/releases)
- ✅ Claude Code v2.1.316: fixed sub-agents that inherited a parent sub-agent's model moving to the main model when a
  background job woke them; fixed `--restricted` sessions uploading files from outside the working directories; fixed
  shell commands left running when Claude Code exits by itself. All touch how Aide's headless steps run.
  [Release](https://github.com/anthropics/claude-code/releases)
- ✅ Claude Code v2.1.316: an `autoMode.allow` list without `"$defaults"` no longer removes the built-in rule on
  scheduled-task prompts. The board's scheduled jobs run headless, so this is the behaviour they get.
  [Release](https://github.com/anthropics/claude-code/releases)
- ℹ Claude Code v2.1.316: `CLAUDE_CODE_DISABLE_ULTRATHINK`, Claude apps gateway pooled budgets and layered policy,
  `/code-review` findings card in cloud sessions, VS Code gateway sign-in, Claude Tag and Code Review analytics fixes.
- ⚠️ OpenCode v2.2.3: in managed policy `integration.use` now covers integrations only; MCP, skill and plugin access
  need `mcp.use`, `skill.use` and `plugin.use`. Aide installs skills for OpenCode, so a machine with a managed policy
  must allow `skill.use` for them to load. [Release](https://github.com/anomalyco/opencode/releases)
- ✅ OpenCode v2.2.3: a built-in Claude Agent provider that uses the Claude Code login. It gives OpenCode a model
  without a separate provider login, which the repo's note that no model is reachable until a provider is logged in
  does not yet cover. [Release](https://github.com/anomalyco/opencode/releases)
- ✅ OpenCode v2.2.5: calls to a tool named `bash` now run as `shell`. A skill that names the `bash` tool by name is
  unaffected in text, but a permission rule written for `bash` should be checked. [Release](https://github.com/anomalyco/opencode/releases)
- ℹ OpenCode v2.2.4 artifacts, schedules under `opencode serve` and v2.2.5 `compaction.buffer` percentage; no Copilot or
  Codex release in the period; the Claude blog, resources, Anthropic news and Copilot blog show nothing newer than Oct 28.
- ℹ X list digests of Oct 30 and Oct 31 could not be read (Chrome not connected), so those two days are a gap.

### 2026-10-30

Oct 29 – Oct 30. Not read: the Codex changelog page past its first 100,000 characters, the OpenCode changelog page past its
first 100,000 characters, the OpenAI developer blog (no dates shown), Artificial Analysis (the harness comparison there is
still "coming soon"), the GitHub Copilot blog (newest post shown is Oct 20), the Claude Code v2.1.314 notes (the release
page cut them off in the middle; the tag page gave the last 15 bullets, all cloud sessions, Remote Control and Claude Tag),
the Copilot changelog (titles only, newest Oct 28). The X list digest of Oct 30 says the list could not be read (the
machine's Chrome was not connected); the digest of Oct 29 was read in the last review. Of the watched pages, the Claude
prompting page for Fable 5.1 changed in what it advises (below); `agents.md` (star counts), the hooks guide, the Claude Code
and Agent Skills best-practices pages, the Codex and Copilot pages, the OpenCode rules, skills and agents pages, the
agentskills.io specification and the three Anthropic engineering articles changed in layout or related links only; the
Haiku 5.5 and Sonnet 5.5 pages gained a migration pointer and the Haiku page a system-prompt note.

**Claude Code (v2.1.314):**

| Date   | Version  | News                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Source                                                                      |
|--------|----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| Oct 30 | v2.1.314 | New `permissions.blockWritesOutsideWorkingDirectories`: Write, Edit and NotebookEdit refuse paths outside the working directories in every permission mode; `claude -p` that fails at startup now prints the error and exits 1 (was exit 0 with no output); sandbox protections now apply to a worktree entered by `claude -p --resume` or `--continue`; hooks matching Bash now run on commands started by the Monitor tool (they can block or ask, not approve or rewrite); a PreCompact hook's output is cut at 10,000 characters; "Continue automatically at usage limit" no longer continues more than three times without a prompt when a task restarts itself (a `/goal` check-in, a background or scheduled task); `--setting-sources` now excludes a file fully; `~/.claude/skills/.trash` and `plugins/.trash` are capped at about 1024 entries; the Bash edit diff no longer lists a whole CRLF file as changed; many fixes for the gateway, Bedrock, Foundry, Remote Control, cloud sessions and vim mode | [Releases](https://github.com/anthropics/claude-code/releases/tag/v2.1.314) |

**GitHub Copilot CLI (v1.0.105, no newer release):**

| Date | Version | News                                       | Source                                                     |
|------|---------|--------------------------------------------|------------------------------------------------------------|
| —    | —       | No release or changelog entry after Oct 28 | [Releases](https://github.com/github/copilot-cli/releases) |

**OpenAI Codex CLI (v0.166.0):**

| Date   | Version  | News                                                                                                                                                                                                                                                                                                                                                                                         | Source                                               |
|--------|----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------|
| Oct 29 | v0.166.0 | Keyboard-driven transcript selection with search; GPT-6.1 Terra in the bundled, Vertex AI and Bedrock model catalogs; `codex queue --resume` resumes unloaded threads; clearer safety-block explanations in the TUI; `codex doctor --network-only`; approval and permission settings preserved when resuming or forking threads; reasoning-token accounting preserved across resume and fork | [Releases](https://github.com/openai/codex/releases) |

**OpenCode (v2.2.2):**

| Date   | Version | News                                                                                                                                                                                                                                                                                                                  | Source                                                     |
|--------|---------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------|
| Oct 29 | v2.2.2  | Image generation (`experimental_image_generate`) on by default when a connected provider supports image models; worktree picker from the current branch on the new-session screen; one comment editor for timeline quotes, terminal quotes and browser annotations; SDK `if` and `until` inputs for scheduled prompts | [Releases](https://github.com/anomalyco/opencode/releases) |

**Relevance for aide:**

- ⚠️ Claude Code v2.1.314: `claude -p` now exits 1 with the error printed when startup fails; before it exited 0 with no
  output. The runner starts `claude -p` for every step, so a step that failed at startup used to look like an empty
  success and now fails. This is the safer behaviour; the next real run is where to watch it.
  [Release](https://github.com/anthropics/claude-code/releases/tag/v2.1.314)
- ✅ Claude Code v2.1.314: sandbox protections now apply to a worktree entered by `claude -p --resume` or `--continue`.
  Aide's steps run in worktrees and resume sessions, so a resumed step is now sandboxed the same as a fresh one.
  [Release](https://github.com/anthropics/claude-code/releases/tag/v2.1.314)
- ✅ Claude Code v2.1.314: new setting `permissions.blockWritesOutsideWorkingDirectories` refuses Write, Edit and
  NotebookEdit outside the working directories in every permission mode. Aide's steps write to the specs worktree as an
  additional directory, so the setting would need that directory listed before anyone turns it on.
  [Release](https://github.com/anthropics/claude-code/releases/tag/v2.1.314)
- ✅ Claude Code v2.1.314: hooks matching Bash now run on Monitor-started commands (block or ask only), and a PreCompact
  hook's output is cut at 10,000 characters. Aide's `guard-push` hook is a Bash hook, so it now also sees Monitor commands.
  [Release](https://github.com/anthropics/claude-code/releases/tag/v2.1.314)
- ✅ Prompting page for Fable 5.1 (watched): the thinking-block check can now be set with
  `thinking.block_binding.prefix_mismatch_behavior` (`error` or `drop_block`, beta header
  `thinking-binding-controls-2026-08-01`), and cache reads cost $0.25 per million tokens (2.5 percent of the input
  price). An API matter; Aide calls the models through Claude Code only, so nothing changes.
  [Page](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1)
- ✅ Codex v0.166.0: approval and permission settings are kept when a thread is resumed or forked. Aide installs only
  skills and `AGENTS.md` for Codex. [Release](https://github.com/openai/codex/releases)
- ℹ OpenCode v2.2.2 (image generation by default, worktree picker) and v2.2.1's `/goal` from the last review; Codex
  v0.166.0 transcript selection, GPT-6.1 Terra and `codex doctor --network-only`; Anthropic's engineering articles now
  link to "Anthropic acquires Stainless", "Code execution with MCP" and "Demystifying evals for AI agents" (not read here).
- ℹ Haiku 5.5 prompting page: system-prompt text is added to new conversations only, since a request sending thinking
  blocks back after the system prompt changed can fail with 400; to change instructions mid-conversation, put them in the
  newest turn. Aide starts each step as a new session.
- ℹ Claude posts on Oct 28 (Enterprise, legal artifacts) were in the last review; the Claude blog, resources and Anthropic
  news pages show nothing newer than Oct 28 besides an empty "October 30, 2026" heading.

### 2026-10-29

Oct 28 – Oct 29. Not read: Codex v0.165.0-alpha.1.2 and v0.166.0-alpha.1 to -alpha.6 builds (no notes), the Codex
changelog page past its first 100,000 characters, the OpenAI developer blog (no dates shown), Artificial Analysis (the
harness comparison there is still "coming soon"), the GitHub Copilot blog (newest post shown is Oct 20), the Copilot
changelog entries of Oct 28 other than the two opened (the listing shows titles only). The X list digest of Oct 29 was
read. Of the watched pages, `agents.md` changed (a star count only) and the Copilot cloud-agent best-practices page changed
(the product renamed "Copilot in the cloud"; the advice is the same); the Claude prompting pages for each model
(`prompting-claude-*`) are new to the watch and stored, nothing to compare yet.

**Claude Code (v2.1.312, no newer release):**

| Date   | Version | News                                                                                                             | Source                           |
|--------|---------|------------------------------------------------------------------------------------------------------------------|----------------------------------|
| Oct 28 | —       | "Smart reports, surveys, and pooled group budgets for Claude Enterprise"; "Introducing artifacts for legal work" | [News](https://claude.com/blog/) |

**GitHub Copilot CLI (v1.0.105):**

| Date   | Version | News                                                                                                                                                                                                                                             | Source                                                                                                    |
|--------|---------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| Oct 28 | —       | GitHub-verified MCP servers ("connectors", public preview, 26 at launch): in the CLI, `/mcp` then the Connectors tab; Business and Enterprise need an admin to enable the `Editor preview features` policy and to allow them in an MCP allowlist | [Changelog](https://github.blog/changelog/2026-10-28-connect-your-tools-to-copilot-without-all-the-setup) |
| Oct 28 | —       | Copilot app: Projects (public preview) coordinates agents across repositories; computer use (public preview); Copilot Fusion routes models; Agentic Workflows generally available; Automations; the SDK becomes Microsoft Copilot SDK            | [Changelog](https://github.blog/changelog/label/copilot/)                                                 |

**OpenAI Codex CLI (v0.165.0, no newer release):**

| Date   | Version        | News                        | Source                                               |
|--------|----------------|-----------------------------|------------------------------------------------------|
| Oct 29 | v0.166.0-alpha | Alpha builds only, no notes | [Releases](https://github.com/openai/codex/releases) |

**OpenCode (v2.2.1):**

| Date   | Version | News                                                                                                                                                                                                                                                                                                             | Source                                                     |
|--------|---------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------|
| Oct 29 | v2.2.1  | `/goal <objective>` keeps a session going until a reviewer confirms it is met; scheduled prompts (`/schedule`, experimental); opt-in `image_generate` tool; Responses API for OpenRouter, DigitalOcean and Venice. Breaking, `@opencode/ai` only: four image providers removed, five legacy entry points removed | [Releases](https://github.com/anomalyco/opencode/releases) |
| Oct 28 | v1.19.5 | Failed TUI worker requests return an error instead of leaving the caller waiting                                                                                                                                                                                                                                 | [Releases](https://github.com/anomalyco/opencode/releases) |

**Relevance for aide:**

- ⭐ X list, @bcherny (Oct 28): Claude Code's team found no regression behind reports of fast token burn; most cases were
  one or two heavy sessions, and subagents inherit the effort level by default. Aide passes `--effort` per step
  (`core/scripts/lib/run-spec/setup/invocation.sh:368`, `dashboard/src/serve/serve-helpers/runner-argv.ts:233`), so every
  subagent a step spawns runs at that step's effort. [Post](https://x.com/bcherny/status/2115592371224346734)
- ⚠️ OpenCode v2.2.1 removes providers and entry points in `@opencode/ai` only; the CLI, desktop and HTTP API are
  unaffected, and Aide installs only skills and `AGENTS.md`. The supported-version row is stamped below.
  [Release](https://github.com/anomalyco/opencode/releases)
- ✅ Copilot connectors: GitHub-verified MCP servers reachable from `/mcp` in the CLI. Aide installs no MCP servers for
  Copilot, so nothing changes. [Changelog](https://github.blog/changelog/2026-10-28-connect-your-tools-to-copilot-without-all-the-setup)
- ✅ Copilot agent-skills page: personal skills are made available in cloud sandbox sessions by putting them in
  `.copilot/skills` in a dotfiles repository (not for GitHub Actions-based sessions). Aide installs to `~/.agents/skills`,
  which does not reach a cloud session.
  [Page](https://docs.github.com/en/copilot/concepts/customizations/agent-skills)
- ✅ OpenCode v2.2.1 `/goal`: runs until a reviewer confirms the objective, the same idea as Aide's acceptance criteria
  checked by a separate step. [Release](https://github.com/anomalyco/opencode/releases)
- ✅ X list, @wolfe_jam (Oct 28): of 187 public skills, 8 say when they are done and 12 say what they touch; a skill that
  says "never commit, tag or push" held an agent back in a small test. Aide's skills bound the agent the same way.
  [Post](https://x.com/wolfe_jam/status/2115525135960551858)
- ✅ X list, @AgenticAIFdn (Oct 28): summary of GitHub Universe (Copilot Projects, Copilot Memory, automations); the
  changelog entries opened show no change to instruction files or skill paths.
  [Post](https://x.com/AgenticAIFdn/status/2115632349740450084)
- ℹ Anthropic posts on AI for Science, drug development and GSA, and Claude posts on Enterprise, legal artifacts and
  financial advisors, are not about coding agents; the Oct 27 post on Claude Code costs on Google Cloud was in the last
  review. X list: @theo on automated gates and an Artificial Analysis ranking, @simonw on Opus 5.5.
- ℹ Watched pages: `agents.md` (star count), Copilot cloud-agent best practices (rename); the rest unchanged or new.

### 2026-10-28

Oct 27 – Oct 28. Not read: Codex v0.165.0-alpha and v0.166.0-alpha builds (no notes), the Codex changelog page past its
first 100,000 characters, the OpenAI developer blog (no dates shown), Artificial Analysis (the harness comparison there is
still "coming soon"), the GitHub Copilot blog (newest post shown is Oct 20), the Copilot changelog entry "GitHub Copilot
supports server-to-server authentication" (no text). The X list digest of Oct 28 was read. Of the watched pages, three
changed that the run cannot assess, because the watch script's output was cut off before their diffs and a second run
compares a page with itself: `agents.md`, the Claude Code prompting best-practices page, and the Agent Skills
best-practices page (the part of its diff that was seen is typographic quotes only).

**Claude Code (v2.1.312):**

| Date   | Version  | News                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Source                                                                      |
|--------|----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| Oct 27 | v2.1.312 | Prompt and agent hooks run at most 24 at a time per session, subagents included (a `timeout` under 1 second counts as 1); per-directory and `paths:` skills found after a Bash `cd` into a git repository; a command with an invalid name no longer stops all commands loading (could leave `claude -p` with no output); a subagent's `autoCompactWindow` now lowers `CLAUDE_CODE_AUTO_COMPACT_WINDOW`; Write no longer overwrites a very large CLAUDE.md or rules file it only read the start of | [Releases](https://github.com/anthropics/claude-code/releases/tag/v2.1.312) |
| Oct 27 | —        | "Manage costs and demonstrate ROI for Claude Code on Google Cloud"                                                                                                                                                                                                                                                                                                                                                                                                                                | [News](https://claude.com/blog/)                                            |

**GitHub Copilot CLI (v1.0.105):**

| Date   | Version  | News                                                                            | Source                                                     |
|--------|----------|---------------------------------------------------------------------------------|------------------------------------------------------------|
| Oct 28 | v1.0.105 | Fixed picking Copilot Fusion High or Max in `/model` from long-context sessions | [Releases](https://github.com/github/copilot-cli/releases) |

**OpenAI Codex CLI (v0.165.0):**

| Date   | Version  | News                                                                                                                                                                                                                                                                                                                                                                                    | Source                                               |
|--------|----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------|
| Oct 27 | v0.165.0 | Built-in Google Cloud Vertex AI provider (`model_provider = "gcp"`); GPT-6.1 Terra in the model catalogs; reasoning effort can change mid-conversation by default; memory v2 on by default for fresh profiles, with import of other agents' memories; queued agent messages no longer restart work after an interrupt or a switch to Plan mode; a marketplace URL validation gap closed | [Releases](https://github.com/openai/codex/releases) |

**OpenCode (v2.2.0):**

| Date   | Version | News                                                                                                                                                                                                                                                                                                                                 | Source                                                                |
|--------|---------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------|
| Oct 27 | v2.2.0  | Breaking: `@opencode/ai` root exports the Promise API (Effect API moved to `@opencode/ai/effect`), the OpenCode GitHub Action is no longer published, TUI plugins need OpenTUI 0.7. Plugins can manage keyed session instructions without touching the system prompt; configurable prompt-cache TTLs; desktop plugins (experimental) | [Releases](https://github.com/anomalyco/opencode/releases/tag/v2.2.0) |

**Relevance for aide:**

- ⚠️ OpenCode v2.2.0 has three breaking changes. None touches what Aide installs (skills and `AGENTS.md`; Aide does not use
  the GitHub Action, `@opencode/ai` or TUI plugins, which a search of the repository confirms), but the supported-version
  row and the OpenCode section of the matrix should be checked against 2.2.0.
  [Release](https://github.com/anomalyco/opencode/releases/tag/v2.2.0)
- ⚠️ Claude Code v2.1.312 caps prompt and agent hooks at 24 at a time per session, subagents included. Aide's hooks
  (`scripts/guard-push`) are command hooks, so the cap should not reach them; worth verifying that no runner step starts
  many prompt or agent hooks. [Release](https://github.com/anthropics/claude-code/releases/tag/v2.1.312)
- ⚠️ X list, @theo (Oct 28), quoting a Claude Code engineer: `--dangerously-skip-permissions` still blocks things like
  `rm -rf ~`, and the 27 Oct release adds an env var `CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS=1` to disable that
  guard. The v2.1.312 release notes do not mention it (checked on the release page), so the claim is unconfirmed. Aide's
  runner starts implement steps with `bypassPermissions` (`dashboard/src/serve/serve-helpers/config.ts`) and does not set
  that variable. [Post](https://x.com/theo/status/2114978312426791384)
- ✅ Claude Code v2.1.312: `paths:` skills found after a `cd` into a repository subfolder, and a command with an invalid
  name no longer leaves `claude -p` with no output, both bear on headless runs and skills.
  [Release](https://github.com/anthropics/claude-code/releases/tag/v2.1.312)
- ✅ Codex v0.165.0: reasoning effort changeable mid-conversation, memory v2 on by default for fresh profiles, and a Vertex
  AI provider; none changes how Aide installs. [Release](https://github.com/openai/codex/releases)
- ✅ X list, @mattpocockuk (Oct 28): agents do best on fully verifiable tasks and wrongly claim "done" on partly verifiable
  ones; this matches Aide's acceptance criteria and test-first steps.
  [Post](https://x.com/mattpocockuk/status/2115035446627459461)
- ✅ X list, @AgenticAIFdn (Oct 28): promotes Agent Skills as the way to share a team's process; Aide ships its skills in that
  format. [Post](https://x.com/AgenticAIFdn/status/2115111507398664645)
- ℹ Copilot CLI v1.0.105 is a bug fix. Anthropic posts on a drug-development effort, a GSA partnership and an S-1, and
  Claude posts on financial advisors and nonprofits, are not about coding agents. X list, @coderabbitai: security review
  across linked repos.
- ℹ Watched pages: `agents.md`, the Claude Code prompting best-practices page and the Agent Skills best-practices page
  changed, diffs lost (see above); the rest unchanged.

### 2026-10-27

Oct 26 – Oct 27. Not read: Copilot v1.0.104-1 to -4 and Codex v0.165.0 and v0.166.0 alphas (no notes), the Codex
changelog page past its first 100,000 characters, the OpenAI developer blog (no dates shown), Artificial Analysis (the
harness comparison there is still "coming soon"). The X list digest of Oct 27 could not be read: the list is
unreachable because the machine's Chrome is not connected to the Claude account. Of the watched pages, `agents.md` and
the Claude Code hooks guide also changed, but their diffs were lost (the watch script's output was cut off before them
and a second run compares the page with itself), so they are not assessed.

**Claude Code (v2.1.311):**

| Date   | Version  | News                                                                                                                                                                                                                                                                                                                                                                                                     | Source                                                                      |
|--------|----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| Oct 26 | v2.1.311 | `--hold-idle-file` and `--max-hold-min` for `self-hosted-runner`; sessions that hit "Usage credits required for 1M context" past 200K tokens now compact and continue; `SubagentStop` hooks fired about twice a minute instead of once, fixed; subagents can use MCP tools from servers that connect after they start; `ultrathink` runs at xhigh effort; `DISABLE_COMPACT` can only turn compaction off | [Releases](https://github.com/anthropics/claude-code/releases/tag/v2.1.311) |
| Oct 22 | —        | "Donating Agent Skills to the Agentic AI Foundation"                                                                                                                                                                                                                                                                                                                                                     | [News](https://www.anthropic.com/news)                                      |

**GitHub Copilot CLI (v1.0.104):**

| Date   | Version  | News                                                                                                                                                                                                            | Source                                                     |
|--------|----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------|
| Oct 27 | v1.0.104 | Managed "fusion" model starts sessions on Auto; Autopilot sessions wait for attached background tasks past the timeout (`-p --autopilot` still honours it); Assisted Permissions work without experimental mode | [Releases](https://github.com/github/copilot-cli/releases) |
| Oct 26 | —        | "GitHub Copilot assisted permissions generally available"; "GPT-6.1 Terra in GitHub Copilot"                                                                                                                    | [Changelog](https://github.blog/changelog/label/copilot/)  |

**OpenAI Codex CLI (no stable release after v0.164.0):**

| Date   | Version          | News                                                                                             | Source                                                |
|--------|------------------|--------------------------------------------------------------------------------------------------|-------------------------------------------------------|
| Oct 27 | v0.166.0-alpha.1 | Alphas only, no notes                                                                            | [Releases](https://github.com/openai/codex/releases)  |
| Oct 26 | —                | "GPT-6.1 Terra in Work and Codex": a fast model with strong image understanding and computer use | [Changelog](https://learn.chatgpt.com/docs/changelog) |

**OpenCode (no release after v2.1.4):**

| Date | Version | News                    | Source                                     |
|------|---------|-------------------------|--------------------------------------------|
| —    | —       | No new release or entry | [Changelog](https://opencode.ai/changelog) |

**Relevance for aide:**

- ⭐ The Claude Code best-practices page was largely rewritten (watched page). It now says "your first plain prompt in a
  fresh session already does the right thing", that new terminal and VS Code sessions "start in auto mode", that a rule
  that cannot bend belongs in a hook or deny rule while a line that keeps being missed means "the file needs to be
  shorter", and its "What you can stop doing" table drops: managing the context window aggressively, ALL CAPS emphasis,
  "use subagents to protect your context window", "delegate to a subagent for a better answer" (a fresh reviewer still
  helps), "loop until done" lines in prompts, and describing architecture and file layout in CLAUDE.md ("Claude reads the
  repo itself"). Touches Aide's CLAUDE.md and `.claude/rules/development.md` (a layout section and a documentation table
  Claude can find itself), the shared rules in `core/rules/`, the plan reviewers and the review in `docs/AGENTS_AND_LOOPS.md`,
  and the permission mode the runner starts sessions in. Advises differently: less description of what the repo shows,
  deterministic checks (hooks) in place of emphatic prose. [Page](https://code.claude.com/docs/en/best-practices)
- ✅ Claude Code v2.1.311: the `SubagentStop` fix and subagents reaching late-connecting MCP servers matter for the runner's
  and the review's subagents; the compaction change keeps long steps going past 200K tokens.
  [Release](https://github.com/anthropics/claude-code/releases/tag/v2.1.311)
- ✅ Anthropic donates Agent Skills to the Agentic AI Foundation (Oct 22): the skills format Aide's `core/skills/` follows now
  has a neutral home. [News](https://www.anthropic.com/news)
- ✅ Copilot CLI v1.0.104 and the changelog: Assisted Permissions generally available and no longer experimental.
  [Changelog](https://github.blog/changelog/label/copilot/)
- ℹ Codex and Copilot got GPT-6.1 Terra (Oct 26). Anthropic filed an S-1 (Oct 26); Claude Duet, Cowork and nonprofit posts
  are not about coding agents.
- ℹ Watched pages: `agents.md` and the Claude Code hooks guide changed, diffs lost (see above); the rest unchanged.

### 2026-10-26

Oct 25 – Oct 26. Not read: Copilot v1.0.104-3 and Codex v0.165.0-alpha.1 (no notes), the Codex changelog page past its
first 100,000 characters, the OpenAI developer blog (no dates shown), Artificial Analysis (the harness comparison there is
still "coming soon"). One X list digest (Oct 26) was read. The Claude blog posts of Oct 15–22 were not read in the
2026-10-23 review; the four on coding agents are read here.

**Claude Code (no release after v2.1.310):**

| Date   | Version | News                                                                                                 | Source                                                                          |
|--------|---------|------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|
| —      | —       | No new release                                                                                       | [Releases](https://github.com/anthropics/claude-code/releases)                  |
| Oct 22 | —       | "Building agents: When to fold subagents into your main agent loop"                                  | [Blog](https://claude.com/resources/articles)                                   |
| Oct 16 | —       | "How the Claude Code team does code review"                                                          | [Blog](https://claude.dev/blog/solving-code-review-at-anthropic/)               |
| Oct 19 | —       | "Redesigning source control at Anthropic" (Scion, a version control system for always-online agents) | [Engineering](https://www.anthropic.com/engineering/redesigning-source-control) |

**GitHub Copilot CLI (no release after v1.0.104-3 pre):**

| Date | Version | News                                           | Source                                                     |
|------|---------|------------------------------------------------|------------------------------------------------------------|
| —    | —       | No new release; no new changelog entry or post | [Releases](https://github.com/github/copilot-cli/releases) |

**OpenAI Codex CLI (no release after v0.164.0):**

| Date | Version | News                                                               | Source                                               |
|------|---------|--------------------------------------------------------------------|------------------------------------------------------|
| —    | —       | No new stable release; no entry on the changelog page after Oct 23 | [Releases](https://github.com/openai/codex/releases) |

**OpenCode (no release after v2.1.4):**

| Date | Version | News                    | Source                                     |
|------|---------|-------------------------|--------------------------------------------|
| —    | —       | No new release or entry | [Changelog](https://opencode.ai/changelog) |

**Relevance for Aide:**

- ⭐ Article on code review, Claude Code team (Oct 16): "Claude verifies its own work first by running tests, builds, and linters",
  "a fresh-context subagent reviews the diff", separate verifier agents "vote on each finding", human review scaled to a
  risk tier set by the change and not the author, review rounds capped (after three, ask the author to rethink), every
  incident or revert turned into an eval case for the reviewer. Touches the review in Implement (`docs/AGENTS_AND_LOOPS.md`,
  `core/scripts/lib/run-spec/turn/review.sh`), which is one session and one fix turn. Advises differently: the article
  uses verifier agents per finding and re-scores the reviewer on past incidents; Aide's review has neither.
  [Article](https://claude.dev/blog/solving-code-review-at-anthropic/)
- ⭐ Article on subagents (Oct 22): "Prefer a single agent loop", keep subagents for context bloat, parallel work with fresh
  context or tool-selection trouble, "split work by context, not by org chart", and fold subagents in one at a time against
  an eval set. Touches the three parallel plan reviewers in Analyze, which run on every spec whatever its complexity
  (`docs/AGENTS_AND_LOOPS.md`, `core/skills/aide-analyze/references/plan-review.md`); the article would have that choice
  tested against evals (`docs/REPLAY.md`). [Article](https://claude.com/resources/articles)
- ✅ "Redesigning source control at Anthropic" (Oct 19): treat agents as always-online clients, minimise checkouts, keep shared
  branch state small; Anthropic says Scion suits only enormous monorepos. Aide's per-step worktrees are the opposite choice and
  fine at its size. [Article](https://www.anthropic.com/engineering/redesigning-source-control)
- ✅ X list (Oct 26): a post argues one can check deterministically whether a PR can be auto-merged (only reorganises code,
  does not change the module graph, does not make test coverage worse); a possible gate before landing a step's branch.
  [Post](https://x.com/mattpocockuk/status/2114311664069718370)
- ✅ X list (Oct 26): a software factory built on GitHub Actions in Matt Pocock's course, the same idea as the queue and runner
  ([post](https://x.com/mattpocockuk/status/2114432666103931215)); Theo reports Gemini inventing line numbers and arguments when
  used as a reviewer, which argues for a check that each `file:line` a finding cites exists
  ([post](https://x.com/theo/status/2114483219538296946)).
- ℹ The Brotli remote code execution claim (Oct 24 announcement) was repeated in the Oct 26 digest; nothing new beyond the
  2026-10-24 review. OpenClaw v2026.10.7 fixes Claude CLI context; "how i work with agents in 2026" by badlogicgames; models
  adding unrequested "phases" to specs.
- ℹ Watched pages: all 19 unchanged.

### 2026-10-25

Oct 24 – Oct 25. Quiet period. Not read: Copilot v1.0.104-3 (no notes), the Codex changelog page past its first
100,000 characters, the OpenAI developer blog (no dates shown), Artificial Analysis (the harness comparison there is
still "coming soon"). One X list digest (Oct 25) was read.

**Claude Code (no release after v2.1.310):**

| Date | Version | News                                                       | Source                                                         |
|------|---------|------------------------------------------------------------|----------------------------------------------------------------|
| —    | —       | No new release; no new post on the blog or the news page   | [Releases](https://github.com/anthropics/claude-code/releases) |

**GitHub Copilot CLI (Oct 24, v1.0.104-3 pre):**

| Date   | Version    | News                             | Source                                                     |
|--------|------------|----------------------------------|------------------------------------------------------------|
| Oct 24 | v1.0.104-3 | Pre-release, "Fixes and changes" | [Releases](https://github.com/github/copilot-cli/releases) |

**OpenAI Codex CLI (no release after v0.164.0):**

| Date | Version | News                                                              | Source                                               |
|------|---------|-------------------------------------------------------------------|------------------------------------------------------|
| —    | —       | No new stable release; only v0.165.0-alpha.1 (Oct 23, no notes)   | [Releases](https://github.com/openai/codex/releases) |

**OpenCode (no release after v2.1.4):**

| Date | Version | News                      | Source                                     |
|------|---------|---------------------------|--------------------------------------------|
| —    | —       | No new release or entry   | [Changelog](https://opencode.ai/changelog) |

**Relevance for Aide:**

- ✅ The Claude Code hooks guide changed its advice on several PreToolUse hooks that rewrite the same tool input: it used
  to say the last one to finish wins, and now says Claude Code does not merge the rewrites or guarantee which one the tool
  runs with (`https://code.claude.com/docs/en/hooks-guide`). No Aide document states the old rule, and no Aide hook rewrites
  tool input, so nothing needs changing.
- ℹ X list (Oct 25): a post says all Agents SDK use drains the 5-hour limit faster than Claude Code does directly
  ([post](https://x.com/theo/status/2114166439813017873)). Aide's runner calls `claude -p` and not the Agents SDK, so it is
  not affected.
- ℹ X list (Oct 25): Agent Skills, Open Responses, OpenEnv and OpenSandbox have joined the Agentic AI Foundation (already
  covered by the 2026-10-23 review); Google's Harness² framework for tuning an agent's harness; T3 Code remote work.
- ℹ Watched pages: `agents.md` changed only in a repository star count.

### 2026-10-24

Oct 23 – Oct 24. Not read: Codex changelog page past its first 100,000 characters, the Codex v0.165.0-alpha.1 and
v0.164.0-alpha.11.1 builds (no notes), Copilot v1.0.104-1 (no notes), the OpenAI developer blog (no dates shown),
Artificial Analysis (the harness comparison there is still "coming soon"). One X list digest (Oct 24) was read.

**Claude Code (Oct 23, v2.1.310):**

| Date   | Version  | News                                                                                                                                                                  | Source                                                         |
|--------|----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------|
| Oct 23 | v2.1.310 | Monitor tool on Bedrock/Vertex/Foundry; MCP tool timing out on an unanswered elicitation in `-p` now tells Claude not to repeat the call; Windows PreToolUse hook fix | [Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 23 | —        | Claude Cowork and chat come together for Enterprise; Claude Duet safety, privacy and security                                                                         | [Blog](https://claude.com/blog/)                               |

**GitHub Copilot CLI (Oct 23 – Oct 24, v1.0.104-0 → v1.0.104-2 pre):**

| Date   | Version    | News                                                                                       | Source                                                     |
|--------|------------|--------------------------------------------------------------------------------------------|------------------------------------------------------------|
| Oct 23 | v1.0.104-0 | Assisted Permissions without experimental mode; saved Auto preference fallback             | [Releases](https://github.com/github/copilot-cli/releases) |
| Oct 24 | v1.0.104-2 | Autopilot waits for background tasks (not in `-p --autopilot`); managed model "fusion" fix | [Releases](https://github.com/github/copilot-cli/releases) |
| Oct 23 | —          | Usage metrics API adds usage from tools like OpenCode; Copilot in Teams                    | [Changelog](https://github.blog/changelog/label/copilot/)  |

**OpenAI Codex CLI (Oct 23, v0.164.0):**

| Date   | Version  | News                                                    | Source                                               |
|--------|----------|---------------------------------------------------------|------------------------------------------------------|
| Oct 23 | v0.164.0 | Already in the 2026-10-23 review (stable release notes) | [Releases](https://github.com/openai/codex/releases) |

**OpenCode (Oct 23, v2.1.4):**

| Date   | Version | News                                                                                                                                     | Source                                     |
|--------|---------|------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------|
| Oct 23 | v2.1.4  | MCP input forms shown instead of the call timing out; `experimental.background_compaction`; experimental TUI tools; `connectClientMcp()` | [Changelog](https://opencode.ai/changelog) |

**Relevance for Aide:**

- ⭐ MCP elicitation: Claude Code CLI got MCP Tasks and Elicitations (X list, Oct 23), and v2.1.310 changes the error for a
  tool call that times out on an unanswered elicitation in a non-interactive session; OpenCode v2.1.4 now shows MCP input
  forms. Proposed: add to `docs/AI_SUPPORT_MATRIX.md` how elicitation behaves in `claude -p`, and check whether
  `core/scripts/aide-run-spec` should deny it so a headless run cannot wait for an answer.
  [Post](https://x.com/ClaudeDevs/status/2113698007892070527)
- ⚠️ OpenCode docs for skills changed: the `opencode/slash` and `opencode/autoinvoke` metadata keys are gone and the page
  now says OpenCode 1 does not use metadata to control skills (`https://opencode.ai/docs/skills`). Proposed: confirm in
  `.claude/skills/ai-tools-reference/SKILL.md` that nothing there relies on these keys, and note the 1 versus 2 difference.
- ⚠️ OpenCode docs for agents changed: the Scout subagent is no longer listed, and Plan may now edit only Markdown plan files
  in `.opencode/plans/` (`https://opencode.ai/docs/agents`). Proposed: check the OpenCode part of the reference for the
  built-in agents and the old `~/.opencode/plan/` path.
- ⚠️ OpenAI reports an unauthenticated remote code execution flaw in Brotli, used by Node.js, Bun and Envoy (X list, Oct 23;
  no CVE confirmed). Proposed: check Bun and Node versions on the serving host against fixed releases.
  [Post](https://x.com/OpenAI/status/2113766354386084338)
- ✅ Copilot CLI v1.0.104-0: Assisted Permissions out of experimental; Copilot usage metrics now count OpenCode.
- ℹ Watched pages: wording-only changes on the Claude skill best-practices page and three Anthropic engineering articles.
- ℹ Thariq left Anthropic's Claude Code team; "council" skill idea; Mythos 5 incident analysis; Claude Cowork and chat for Enterprise.
- ℹ LiteLLM/PHP incident claims (X list, no primary source) carry over from the 2026-10-23 review.

### 2026-10-23

Oct 19 – Oct 23. Not read: Claude Code v2.1.304 and v2.1.309 in full (cut off on the releases page), Codex CLI v0.164.0
alphas (no notes), the blogs of Claude, Anthropic, GitHub and OpenAI, and Artificial Analysis. The 19 watched pages
were all `new` (no earlier copy), so none is compared yet. The X list digest of Oct 19 (first one) could not be
read; digests of Oct 20–23 were read.

**Claude Code (Oct 19 – Oct 22, v2.1.304 → v2.1.309):**

| Date   | Version      | News                                                                                                                                                                              | Source                                                         |
|--------|--------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------|
| Oct 19 | v2.1.304     | `/auto-mode-setup`; skill hooks capped at 1,024 per source; `updatedInput` from hooks validated; tool search on behind custom gateways                                            | [Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 20 | v2.1.305     | `allowedMcpServers` no longer filters `managed-mcp.json` stdio servers with `${VAR}` in `env`; `sandbox.allowNestedUserNamespaces`                                                | [Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 21 | v2.1.306     | `claude -p` "Not logged in" fix in cloud sessions                                                                                                                                 | [Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 21 | v2.1.307     | `claude_code.safety_event` OTel event; HTTP MCP retry only for idempotent tools; self-hosted checkout hooks time out at 30 min                                                    | [Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 22 | v2.1.308–309 | Sandbox hardening; `sed -i` now a normal Bash prompt; `claude ultrareview` needs `--trust-workspace` in scripts; skill name collision in `--add-dir` offered as `<folder>:<name>` | [Releases](https://github.com/anthropics/claude-code/releases) |

**GitHub Copilot CLI (Oct 19 – Oct 22, v1.0.100 → v1.0.103):**

| Date   | Version  | News                                                                                                                     | Source                                                     |
|--------|----------|--------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------|
| Oct 19 | v1.0.100 | Skills/plugins from GitHub install links; path-specific `.github/instructions` applied; `--trust-folder` for prompt mode | [Releases](https://github.com/github/copilot-cli/releases) |
| Oct 20 | v1.0.101 | Structured output for subagents; `assistedApprovalInstructions` setting                                                  | [Releases](https://github.com/github/copilot-cli/releases) |
| Oct 21 | v1.0.102 | Subagents honor custom and MCP tool approvals; plugin marketplaces accept git-subdir sources                             | [Releases](https://github.com/github/copilot-cli/releases) |
| Oct 22 | v1.0.103 | ACP sessions honor sandbox settings; `--remote/--no-remote` flags retired                                                | [Releases](https://github.com/github/copilot-cli/releases) |

**OpenAI Codex CLI (Oct 20 – Oct 23, v0.164.0):**

| Date      | Version             | News                                                                                                               | Source                                               |
|-----------|---------------------|--------------------------------------------------------------------------------------------------------------------|------------------------------------------------------|
| Oct 23    | v0.164.0            | `/presets` slots; inline `/model` and `/permissions` arguments; enterprise MCP auth; macOS sandbox checks hardened | [Releases](https://github.com/openai/codex/releases) |
| Oct 20–22 | v0.164.0-alpha.7…12 | Alpha builds, no notes                                                                                             | [Releases](https://github.com/openai/codex/releases) |

**OpenCode (Oct 20 – Oct 22, v1.19.4; OpenCode 2 v2.1.0 → v2.1.3):**

| Date   | Version         | News                                                                                                   | Source                                                     |
|--------|-----------------|--------------------------------------------------------------------------------------------------------|------------------------------------------------------------|
| Oct 20 | v2.1.0          | Public fields renamed to `native`; `Credential.Key.configuration` removed; `session.compacted` removed | [Changelog](https://opencode.ai/changelog)                 |
| Oct 21 | v2.1.2          | `OPENCODE_DISABLE_FREE_MODELS`                                                                         | [Changelog](https://opencode.ai/changelog)                 |
| Oct 22 | v1.19.4, v2.1.3 | Bundled Bun 1.4.4 with security fixes; skill/instruction updates sent as changes only                  | [Releases](https://github.com/anomalyco/opencode/releases) |

**Relevance for Aide:**

- ⭐ Agent Skills standard donated to the Agentic AI Foundation (X list, Oct 22); Skills over MCP (SEP-2640) is now an MCP
  extension. Aide's skills rest on this standard. Proposed: note the neutral governance in `docs/AI_SUPPORT_MATRIX.md`
  and check the spec for changes to frontmatter fields or discovery paths against the allowlist test.
  [Post](https://x.com/ClaudeDevs/status/2113328526413996100)
- ⭐ Claude web/desktop/mobile sessions go to auto mode by default next week (X list, Oct 22), and Claude Code v2.1.304
  adds `/auto-mode-setup`. Proposed: check whether auto mode changes defaults for `claude -p` and compare with the
  permission flags in `core/scripts/aide-run-spec`. [Post](https://x.com/claudeai/status/2113360845409583307)
- ⭐ Codex prompt cache kept 12 h in the API and "forever" for logged-in users (X list, Oct 21); not yet confirmed in the
  Codex changelog. Proposed: verify in the Codex docs, then note it in the Codex part of `docs/CONFIGURATION.md` if real.
  [Post](https://x.com/theo/status/2112713481946570967)
- ⭐ Anthropic OSS Scanner (X list, Oct 20): free scans of critical open source projects. Proposed: check whether Aide's
  dependencies qualify. [Post](https://x.com/ClaudeDevs/status/2112299602510749992)
- ⚠️ Claude Code v2.1.305: `allowedMcpServers` stops filtering `${VAR}`-in-env managed stdio servers; use `deniedMcpServers`.
  Proposed: nothing in Aide sets this, check only on machines with a managed MCP file.
- ⚠️ Claude Code v2.1.309: `claude ultrareview` needs `--trust-workspace` in scripts; `sed -i` no longer restored by `/rewind`;
  stricter sandbox/Edit-deny handling. No Aide script calls `ultrareview`; verify that headless runs are not newly blocked.
- ⚠️ Claude Code v2.1.304: `updatedInput` from PreToolUse hooks is validated; unknown keys dropped. Check `scripts/guard-push`
  does not rely on rewriting input.
- ⚠️ OpenCode v2.1.0 renames public SDK/plugin fields; Aide's OpenCode install uses none known. Copilot v1.0.103 retires
  `--remote/--no-remote`; Aide uses neither.
- ⚠️ Same-day incident claims on PHP, Node.js, GitLab, LiteLLM (X list, Oct 21–23, no primary source). Proposed: check
  Node and bun versions on the dashboard host. OpenCode and Claude Code both ship Bun 1.4.4 security fixes (Oct 22).
- ✅ Claude Code v2.1.307 `claude_code.safety_event`; Copilot `.github/instructions` and skill install links; Codex v0.164.0.
- ✅ X list ideas: PDD Kit (GitHub Next), `/grill-me` question rounds versus `aide-explore`, "code, not spec, is the center"
  debate, MCP-delivered skills — roadmap/comparison candidates, no change to the matrix.
- ℹ Claude Duet, Claude Security beta, Claude on Google Cloud, Codex on Google Cloud Model Garden, Gemini API CLI.
- ℹ X list digest of Oct 19: could not be read (X login).

### 2026-10-19

Oct 12 – Oct 19. No change needed in the support matrix or the reference. Not read in full: Claude Code v2.1.297–298,
Copilot CLI v1.0.97, the second half of the Codex changelog, the X list digest of Oct 19 (list could not be read).

**Claude Code (Oct 14 – Oct 18, v2.1.299 → v2.1.303):**

| Date   | Version  | News                                                                                        | Source                                                         |
|--------|----------|---------------------------------------------------------------------------------------------|----------------------------------------------------------------|
| Oct 14 | v2.1.299 | `CLAUDE_CODE_DISABLE_FILE_MENTIONS`; idle compaction (`idleCompaction`); MCP deny/ask fixes | [Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 14 | v2.1.300 | `prompt.change` mod hook; `agent.spawn` can rewrite prompt and model                        | [Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 15 | v2.1.301 | Skill argument names limited to 64; skills no longer vanish after `/rewind`                 | [Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 16 | v2.1.302 | Prompt/agent hooks limited to 12 per event; fork subagents on by default in `claude -p`     | [Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 18 | v2.1.303 | Bug fixes                                                                                   | [Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 15 | —        | Code Review generally available                                                             | [Blog](https://claude.com/blog/)                               |

**GitHub Copilot CLI (Oct 13 – Oct 16, v1.0.98 → v1.0.100-1 pre):**

| Date   | Version                    | News                                                                                       | Source                                                     |
|--------|----------------------------|--------------------------------------------------------------------------------------------|------------------------------------------------------------|
| Oct 14 | v1.0.98                    | Gemini 4 Argon; command hooks complete reliably under Node                                 | [Releases](https://github.com/github/copilot-cli/releases) |
| Oct 15 | v1.0.99-0…-1 (pre)         | `.github/instructions` files apply automatically; skills/plugins from GitHub install links | [Releases](https://github.com/github/copilot-cli/releases) |
| Oct 16 | v1.0.99-2…v1.0.100-1 (pre) | `--disable-client-telemetry`; no stall on a hung MCP server                                | [Releases](https://github.com/github/copilot-cli/releases) |

**OpenAI Codex CLI (Oct 14 – Oct 17, v0.163.0):**

| Date      | Version            | News                                                                         | Source                                                |
|-----------|--------------------|------------------------------------------------------------------------------|-------------------------------------------------------|
| Oct 15    | v0.163.0           | Searchable `/config`; mid-turn steering; `/daemon`; parallel read-only tools | [Changelog](https://learn.chatgpt.com/docs/changelog) |
| Oct 16–17 | v0.164.0-alpha.1…3 | Alpha builds, no release notes                                               | [Releases](https://github.com/openai/codex/releases)  |
| Oct 14    | —                  | GPT-5.5 retired in Codex for ChatGPT sign-in; use GPT-6.1 Sol                | [Changelog](https://learn.chatgpt.com/docs/changelog) |

**OpenCode (Oct 12 – Oct 16, v1.19.1 → v1.19.3; OpenCode 2 v2.0.27 → v2.0.32):**

| Date      | Version         | News                                                            | Source                                                     |
|-----------|-----------------|-----------------------------------------------------------------|------------------------------------------------------------|
| Oct 15    | v1.19.1         | Session sharing discontinued                                    | [Releases](https://github.com/anomalyco/opencode/releases) |
| Oct 16    | v1.19.2–3       | 1.x installs never offered 2.x; configurable reasoning variants | [Releases](https://github.com/anomalyco/opencode/releases) |
| Oct 12–16 | v2.0.27–v2.0.32 | `instructions` loads globs and URLs; worktree tools             | [Changelog](https://opencode.ai/changelog)                 |

**Relevance for Aide:**

- ⚠️ Claude Code v2.1.302: fork subagents on by default in `claude -p`; no Aide step known to depend on it.
- ⚠️ OpenCode security incident (X list, Oct 18): some users' saved provider keys were misused; Aide's installer stores
  no keys.
- ✅ Copilot `.github/instructions` auto-applied; Claude Code hook limits — no action.
- ℹ Codex GPT-5.5 retirement, OpenCode 2.x beside 1.x, Codex v0.163.0, Code Review GA — no Aide action.

### 2026-10-12

Oct 5 – Oct 12. Claude Haiku 5.5 arrived (default Haiku in Claude Code v2.1.293, selectable in Copilot CLI v1.0.94).
Not read in full: Copilot CLI v1.0.92–1.0.93 (Oct 4–7), the last third of the Codex changelog.

**Claude Code (Oct 5 – Oct 9, v2.1.290 → v2.1.296):**

| Date  | Version      | News                                                                                                                        | Source                                                         |
|-------|--------------|-----------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------|
| Oct 5 | v2.1.290     | `agentId` on `tool.check`; `claude attach`/`claude logs`; symlinked CLAUDE.md/rules fix                                     | [Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 6 | v2.1.291–292 | Regression fixes; `claude plugin install --marketplace`; `effort` on Agent tool; MCP tool names over 128 characters dropped | [Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 7 | v2.1.293     | Haiku 5.5 default Haiku; path-scoped rules load via Bash `cat`/`sed -n`/`grep`                                              | [Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 8 | v2.1.294–295 | Instruction-style `prompt`/`agent` hooks fixed; `onFailure: "block"` for hooks; remote MCP backoff                          | [Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 9 | v2.1.296     | `autoCompactWindow` in subagent frontmatter; MCP description limit 2,048 → 4,096 characters; Read `allow_large`             | [Releases](https://github.com/anthropics/claude-code/releases) |
| Oct 7 | —            | Claude Haiku 5.5: 1M context, $0.10/$0.50 per Mtok                                                                          | [News](https://www.anthropic.com/news)                         |

**GitHub Copilot CLI (Oct 7 – Oct 10, v1.0.94 → v1.0.96 pre):**

| Date     | Version            | News                                                                                   | Source                                                     |
|----------|--------------------|----------------------------------------------------------------------------------------|------------------------------------------------------------|
| Oct 8    | v1.0.94            | Claude Haiku 5.5 in model selection; MCP enable/disable before discovery               | [Releases](https://github.com/github/copilot-cli/releases) |
| Oct 9    | v1.0.95            | Entra broker auth on macOS; sandbox `injectHosts`; managed plugin setup retries hourly | [Releases](https://github.com/github/copilot-cli/releases) |
| Oct 9–10 | v1.0.96-0…-2 (pre) | `/add-dir` grants sandbox access; sandbox secret masking hosts                         | [Releases](https://github.com/github/copilot-cli/releases) |
| Oct 7    | —                  | Local sandboxing generally available; local models in Copilot CLI                      | [Changelog](https://github.blog/changelog/label/copilot/)  |

**OpenAI Codex CLI (Oct 8 – Oct 9, v0.162.0 → v0.162.1):**

| Date  | Version  | News                                                                                                                   | Source                                                |
|-------|----------|------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------|
| Oct 8 | v0.162.0 | Managed Git worktree tools; custom-provider web access and remote compaction settings; ranked tool search in Code Mode | [Releases](https://github.com/openai/codex/releases)  |
| Oct 9 | v0.162.1 | TUI crash and startup failure fixes                                                                                    | [Releases](https://github.com/openai/codex/releases)  |
| Oct 8 | —        | GPT-6.1 Sol Ultrafast in Codex                                                                                         | [Changelog](https://learn.chatgpt.com/docs/changelog) |

**OpenCode (Oct 6 – Oct 11, v1.18.35 → v1.19.0):**

| Date   | Version  | News                                                                                                     | Source                                                     |
|--------|----------|----------------------------------------------------------------------------------------------------------|------------------------------------------------------------|
| Oct 6  | v1.18.35 | Agent-readable stats formats; xAI image tool results                                                     | [Releases](https://github.com/anomalyco/opencode/releases) |
| Oct 11 | v1.19.0  | `opencode upgrade --major` to OpenCode 2; OpenAI ultrafast tier; updates no longer automatic (`/update`) | [Releases](https://github.com/anomalyco/opencode/releases) |

**Relevance for Aide:**

- ⭐ Haiku 5.5 in Claude Code and Copilot CLI: add to the Current models table.
- ✅ Path-scoped rules via Bash reads, hook `onFailure`, subagent `autoCompactWindow`: no action.
- ⚠️ MCP description limit 4,096; MCP tool names over 128 characters dropped: no Aide MCP server affected.
- ℹ Copilot sandboxing GA, Codex worktree tools, OpenCode 2 upgrade path.

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
