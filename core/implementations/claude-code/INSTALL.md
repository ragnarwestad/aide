# Installation Guide - Claude Code

## Table of contents

- [Install](#install)
- [What it installs](#what-it-installs)
- [Check it worked](#check-it-worked)
- [LSP plugins](#lsp-plugins)

---

For a person installing Aide for Claude Code, or checking that install. The prerequisites, what every installer
does, updating and uninstalling are in [docs/INSTALLATION.md](../../../docs/INSTALLATION.md).

## Install

```bash
cd ~/develop/aide
core/implementations/claude-code/install.sh
```

Start a new Claude Code session afterwards: it reads its rules and skills when a session starts.

---

## What it installs

On top of [what every installer puts in place](../../../docs/INSTALLATION.md#what-every-installer-puts-in-place):

| What                                                                    | Where                                           |
| ----------------------------------------------------------------------- | ----------------------------------------------- |
| Every skill in `core/skills/` except `spec-structure`                   | `~/.claude/skills/`                             |
| Every rule in `core/rules/`, `spec-structure` included                  | `~/.claude/rules/`                              |
| The two command-rule hooks                                              | `~/.claude/settings.json`, beside your own      |
| The LSP plugins `typescript-lsp`, `kotlin-lsp` and `jdtls-lsp`          | Claude Code's plugins, when `claude` is on PATH |

Claude Code is the one tool that gets the rules as separate files instead of a block in one instructions file.
`spec-structure` is a rule here rather than a skill: its `paths` frontmatter makes Claude Code load it only when a
spec file is read.

What the hooks do, and the parts of `~/.claude/settings.json` Aide leaves to you, are in [README.md](README.md).

---

## Check it worked

```bash
aide-preflight claude
```

In a Claude Code session, type `/aide-`: the list shows Aide's skills, such as `/aide-explore`. The spec steps
(`/aide-create`, `/aide-analyze` and the rest) are not among them; they run on the board
([Where a spec's steps run](../../../docs/INSTALLATION.md#where-a-specs-steps-run)).

---

## LSP plugins

The installer installs them when the `claude` CLI is on PATH, and otherwise prints these commands:

```bash
claude plugin install typescript-lsp@claude-plugins-official
claude plugin install kotlin-lsp@claude-plugins-official
claude plugin install jdtls-lsp@claude-plugins-official
```
