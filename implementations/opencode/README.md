# OpenCode implementation

What aide installs for [OpenCode](https://opencode.ai), and what it
deliberately does not.

## What is installed

| Piece                  | Where                             |
|------------------------|-----------------------------------|
| Global instructions    | `~/.config/opencode/AGENTS.md`    |
| Shared CLI scripts     | `~/.local/bin/`                   |

That is the whole of it. Run `implementations/opencode/install.sh` to put
it there, and `uninstall.sh` to take the instruction file away again.

## What is not installed, and why

**The skills.** OpenCode scans `~/.agents/skills` and `~/.claude/skills`
for `**/SKILL.md` itself, and those are where the Codex, Copilot and
Claude Code installers already put aide's skills. A third copy would give
one skill two locations, and OpenCode drops a duplicate name rather than
loading both.

## How a model is named

OpenCode brings no model of its own. Every model belongs to a provider
and is named `provider/model` — `opencode/gemini-3.1-pro`,
`github-copilot/gemini-3.8-flash`, `google/gemini-3.5-flash`. Nothing is
reachable until a provider is logged in:

```bash
opencode providers login
opencode models          # what the logged-in providers offer
```

## How a step runs

The dashboard's runner drives it headless:

```bash
opencode run --format json --agent build
```

The prompt arrives on stdin and one JSON event comes back per line. A
step's totals are the SUM over every `step_finish` event, because
OpenCode closes no turn with a single summary.

A permission mode reaches it as an agent rather than a sandbox flag:
`plan` is the read-only one, `build` allows every tool, and `--auto`
additionally answers what `build` would otherwise ask about.

Aide's skills have no slash command here — the model reaches a skill
through a `skill` tool, by name — so a headless step names its skill in
words instead of writing `/aide-implement`.
