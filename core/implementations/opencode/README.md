# OpenCode implementation

## Table of contents

- [Install](#install)
- [What it installs](#what-it-installs)
- [Check it worked](#check-it-worked)
- [What to know about OpenCode](#what-to-know-about-opencode)

---

For a person installing Aide for [OpenCode](https://opencode.ai), or checking that install. The prerequisites, what
every installer does, updating and uninstalling are in [docs/INSTALLATION.md](../../../docs/INSTALLATION.md); which
files OpenCode reads, and how the board runs it, are in
[docs/AI_SUPPORT_MATRIX.md](../../../docs/AI_SUPPORT_MATRIX.md#opencode).

## Install

```bash
mise use -g opencode@latest   # OpenCode, kept current by upgrade-ai-tools

cd ~/develop/aide
core/implementations/opencode/install.sh
```

Then log in to a provider. OpenCode brings no model of its own: every model belongs to a provider and is named
`provider/model`, such as `google/gemini-3.5-flash`, and **nothing is reachable until a provider is logged in**. The
installer says whether one is.

```bash
opencode auth login
opencode models          # what the logged-in providers offer
```

Claude Agent, one of the providers offered there, uses the machine's Claude Code login and needs no key of its own.
`OPENCODE_CLAUDE_PATH` points it at another `claude` executable.

---

## What it installs

On top of [what every installer puts in place](../../../docs/INSTALLATION.md#what-every-installer-puts-in-place):

| What                            | Where                                                                  |
| ------------------------------- | ---------------------------------------------------------------------- |
| Aide's rules (`core/AGENTS.md`) | `~/.config/opencode/AGENTS.md`, in a marked block                      |
| A project's `CLAUDE.md`         | `"CLAUDE.md"` in `instructions` in `~/.config/opencode/opencode.json`  |

No skills: OpenCode scans `~/.agents/skills` and `~/.claude/skills` for `SKILL.md` itself, and those are where the
Codex, Copilot and Claude Code installers put Aide's skills. A third copy would give one skill two locations, and
OpenCode drops a duplicate name rather than loading both. Install for at least one of the other tools too.

---

## Check it worked

```bash
aide-preflight opencode
opencode run -m <provider>/<model> "List the skills you have whose names start with aide-"
```

The answer names Aide's skills, such as `aide-explore`. The spec steps (create, analyze and the rest) are not
skills; they run on the board ([Where a spec's steps run](../../../docs/INSTALLATION.md#where-a-specs-steps-run)).

---

## What to know about OpenCode

- **A skill has no slash command.** The model reaches a skill through a `skill` tool, by its name, so ask for it in
  words: "use the aide-explore skill".
- **It reads only a project's `AGENTS.md` by itself.** With `"CLAUDE.md"` in `instructions` it reads a project's
  `CLAUDE.md` too, beside `AGENTS.md` where the project has both. The installer adds the entry with `jq` and keeps
  the rest of the file; a config with comments (`opencode.jsonc`) is left alone, and you add the entry by hand.
