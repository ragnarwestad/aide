---
name: check-news
description: >-
  Check AI tool news from Anthropic, GitHub and OpenAI.
  Fetches changelogs and news from official sources, assesses relevance
  for aide, and updates the news log.
  Use when: checking AI news, wanting to know what's new in
  Claude Code/Copilot/Codex, updating the news log.
  Do NOT use for: general questions about AI tools (use web search directly).
disable-model-invocation: true
---

# AI news: Check and update

The news log lives in the aide repo: `docs/AI_NEWS_LOG.md`. This skill
is repo-local and runs when you are working in aide.

## Step 1: Find the news log

```bash
git -C ~/develop/aide rev-parse --show-toplevel 2>/dev/null \
  && echo "$(git -C ~/develop/aide rev-parse --show-toplevel)/docs/AI_NEWS_LOG.md"
```

Read `docs/AI_NEWS_LOG.md` and find the date of the last review (the topmost
heading under `## News log`).

## Step 2: Fetch news from sources

Check these sources for news **since the last review**:

### Claude Code

1. WebFetch: `https://github.com/anthropics/claude-code/releases`
2. WebFetch: `https://www.anthropic.com/news`

### GitHub Copilot

1. WebFetch: `https://github.blog/changelog/label/copilot/`
2. WebFetch: `https://github.com/github/copilot-cli/releases`

### OpenAI Codex

1. WebFetch: `https://github.com/openai/codex/releases`
2. WebFetch: `https://developers.openai.com/codex/changelog/`

## Step 3: Filter and assess

For each news item, assess:

- **Is it relevant for aide?** (skills, hooks, agents, MCP, config)
- **Does it require action?** (update ai-tools-reference.md, change install.sh, new skills)
- **How important is it?** Use the icons:
  - ⭐ Direct impact on aide (requires action)
  - ✅ Useful, but no immediate action
  - ℹ️ Informative, low relevance
  - ⚠️ Breaking change or something that must be verified

## Step 4: Update the news log

Add a new section in `docs/AI_NEWS_LOG.md` under `## News log`, **above** the
existing entries (newest first). Use today's date as the heading, and add
the date to the table of contents at the top.

Format — follow the existing pattern in the file:

```markdown
### YYYY-MM-DD

**Claude Code (period):**

| Date | Version | News | Source |
|------|---------|-------|-------|
| ... | ... | ... | [Source](url) |

**GitHub Copilot CLI (period):**

| Date | Version | News | Source |
|------|---------|-------|-------|

**OpenAI Codex CLI (period):**

| Date | Version | News | Source |
|------|---------|-------|-------|

**Relevance for aide:**

- ⭐ Important findings that require action
- ✅ Useful findings
- ℹ️ Informative findings
```

## Step 5: Flag proposals for the matrix and reference

The log is further distilled into two documents in the repo:

- `docs/AI_SUPPORT_MATRIX.md` — distilled current state (versions, mechanisms)
- `.claude/rules/ai-tools-reference.md` — verified config reference

For each ⭐ and ⚠️ finding in this review: assess whether it changes anything in these
two documents (new version, new/changed config path, new mechanism, breaking change).

**Do not edit the documents silently.** Instead, show a checklist with concrete
proposals, and **ask the user to approve** before you edit:

```markdown
Proposed changes (approve before I edit):

AI_SUPPORT_MATRIX.md:
- [ ] Update version Claude Code → vX.Y.Z
- [ ] Add mechanism: ...

ai-tools-reference.md:
- [ ] Update skill path table: ...
```

Once the user has approved, make **surgical** changes to the relevant files.

## Step 6: Summarize

Show a brief summary:
- Number of new news items per tool
- Most important findings (⭐-marked)
- Proposed matrix/reference changes awaiting approval
