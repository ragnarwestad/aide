# GitHub Copilot implementation

## Table of contents

- [Files in this folder](#files-in-this-folder)
- [What to know about Copilot](#what-to-know-about-copilot)
- [Resources](#resources)

---

For a person looking up how Aide sets up the GitHub Copilot CLI. Installing is in [INSTALL.md](INSTALL.md); which
files Copilot reads, verified against an installed version, is in
[docs/AI_SUPPORT_MATRIX.md](../../../docs/AI_SUPPORT_MATRIX.md#github-copilot).

## Files in this folder

| File           | What it is                                                                  |
| -------------- | --------------------------------------------------------------------------- |
| `install.sh`   | Installs Aide for the Copilot CLI ([INSTALL.md](INSTALL.md))                |
| `uninstall.sh` | Removes Aide's rules block from `~/.copilot/copilot-instructions.md`        |

---

## What to know about Copilot

- **Its personal skills are in `~/.agents/skills/`**, not `~/.claude/skills/`, so Copilot and Codex share one copy
  of Aide's skills. A tool's own `uninstall.sh` leaves that copy alone; `./uninstall-all.sh` removes it.
- **It reads a project's `CLAUDE.md`** as well as `AGENTS.md` and `.github/copilot-instructions.md`, so a project
  needs no Copilot configuration of its own.
- **Aide's rules sit in a marked block** in `~/.copilot/copilot-instructions.md`. Text of your own outside the
  block is kept on every install.
- **It asks before it edits a file or runs a command.** `copilot --allow-all-tools` allows every tool for a session;
  `trusted_folders` in `~/.copilot/config.json` pre-approves directories.

---

## Resources

- [Using the Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli)
- [Configuring the Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli)
- [Custom instructions for the CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions)
- [The Copilot CLI repository](https://github.com/github/copilot-cli)
