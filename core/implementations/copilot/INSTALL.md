# Installation Guide - GitHub Copilot

## Table of contents

- [Install](#install)
- [What it installs](#what-it-installs)
- [Check it worked](#check-it-worked)

---

For a person installing Aide for the GitHub Copilot CLI, or checking that install. The prerequisites, what every
installer does, updating and uninstalling are in [docs/INSTALLATION.md](../../../docs/INSTALLATION.md).

## Install

You need a GitHub Copilot subscription that includes the Copilot CLI.

```bash
mise use -g npm:@github/copilot@latest   # the Copilot CLI, kept current by upgrade-ai-tools
copilot login

cd ~/develop/aide
core/implementations/copilot/install.sh
```

Start a new `copilot` session afterwards: it reads its instructions and skills when a session starts.

---

## What it installs

On top of [what every installer puts in place](../../../docs/INSTALLATION.md#what-every-installer-puts-in-place):

| What                                                    | Where                                                       |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| Aide's rules (`core/AGENTS.md`)                         | `~/.copilot/copilot-instructions.md`, in a marked block     |
| Every skill in `core/skills/`                           | `~/.agents/skills/`, shared with Codex                      |

`core/AGENTS.md` holds the rules in `core/rules/` that apply to every turn. The task-specific guidance is in the
skills, which Copilot reads when they are relevant.

---

## Check it worked

```bash
aide-preflight copilot
head -3 ~/.copilot/copilot-instructions.md   # the aide rules marker
```

In a `copilot` session:

```text
/skills info aide-explore
```

It shows `Location: /Users/<you>/.agents/skills/aide-explore/SKILL.md`. The spec steps (`/aide-create`,
`/aide-analyze` and the rest) are not skills; they run on the board
([Where a spec's steps run](../../../docs/INSTALLATION.md#where-a-specs-steps-run)).
