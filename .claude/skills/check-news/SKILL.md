---
name: check-news
description: >-
  Check AI tool news for the four tools Aide installs for: Claude Code,
  GitHub Copilot, OpenAI Codex and OpenCode.
  Fetches changelogs and news from official sources, assesses relevance
  for Aide, and updates the news log.
  Use when: checking AI news, wanting to know what's new in
  Claude Code/Copilot/Codex/OpenCode, updating the news log.
  Do NOT use for: general questions about AI tools (use web search directly).
---

# AI news: Check and update

The news log lives in the Aide repo: `docs/AI_NEWS_LOG.md`. This skill
is repo-local and runs when you are working in Aide.

## Step 1: Find the news log

```bash
git -C ~/develop/aide rev-parse --show-toplevel 2>/dev/null \
  && echo "$(git -C ~/develop/aide rev-parse --show-toplevel)/docs/AI_NEWS_LOG.md"
```

Read `docs/AI_NEWS_LOG.md` and find the date of the last review (the topmost
heading under `## News log`).

## Step 2: Fetch news from sources

Fetch every source in the **Sources** table of `docs/AI_NEWS_LOG.md` (its
`### Sources` section) for news **since the last review**: one WebFetch per
address, all of them, every tool. The table is the one list of sources; add
or change a source there, not here.

## Step 3: Filter and assess

For each news item, assess:

- **Is it relevant for Aide?** (skills, hooks, agents, MCP, config)
- **Does it require action?** (update ai-tools-reference.md, change install.sh, new skills)
- **How important is it?** Use the icons:
  - ⭐ Direct impact on Aide (requires action)
  - ✅ Useful, but no immediate action
  - ℹ Informative, low relevance
  - ⚠️ Breaking change or something that must be verified

## Step 4: Update the news log

Add a new section in `docs/AI_NEWS_LOG.md` under `## News log`, **above** the
existing entries (newest first). Use today's date as the heading, and add
the date to the table of contents at the top.

Then delete every review older than about two months, with its line in the
table of contents. What mattered in it is already in the support matrix and
the reference; git history keeps the rest.

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

**OpenCode (period):**

| Date | Version | News | Source |
|------|---------|-------|-------|

**Relevance for aide:**

- ⭐ Important findings that require action
- ✅ Useful findings
- ℹ Informative findings
```

## Step 5: Flag proposals for the matrix and reference

The log is further distilled into two documents in the repo:

- `docs/AI_SUPPORT_MATRIX.md` — distilled current state (versions, mechanisms)
- `.claude/skills/ai-tools-reference/SKILL.md` — verified config reference

For each ⭐ and ⚠️ finding in this review: assess whether it changes anything in these
two documents (new version, new/changed config path, new mechanism, breaking change).

**Do not edit the documents silently.** Instead, show a checklist with concrete
proposals, and **ask the user to approve** before you edit:

```markdown
Proposed changes (approve before I edit):

AI_SUPPORT_MATRIX.md:
- [ ] Add mechanism: ...
- [ ] Adjust fidelity grade: ...

ai-tools-reference.md:
- [ ] Update skill path table: ...
```

Once the user has approved, make **surgical** changes to the relevant files.

**Version rows are never edited by hand:** run `scripts/stamp-versions` —
it probes the installed CLIs and stamps the "Supported versions" table
with what each tool actually reports.

## Step 6: Summarize

Show a brief summary:
- Number of new news items per tool
- Most important findings (⭐-marked)
- Proposed matrix/reference changes awaiting approval
