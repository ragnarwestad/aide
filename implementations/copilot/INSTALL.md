# Installation Guide - GitHub Copilot

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Detailed installation](#detailed-installation)
  - [Step 0: Install the Copilot CLI](#step-0-install-the-copilot-cli)
  - [Step 1: install.sh](#step-1-install-the-configuration-installsh)
  - [Step 2: Slash commands](#step-2-slash-commands)
- [Verification](#verification)
- [Updating the configuration](#updating-the-configuration)
- [For Aide developers](#for-aide-developers)
- [Important limitations](#important-limitations)
- [Comparison with Claude Code](#comparison-with-claude-code)
- [Troubleshooting](#troubleshooting)
- [Further reading](#further-reading)

---

## Overview

This guide shows how to install the GitHub Copilot integration for the Aide workspace **for the first time**.

**Time required:** ~5 minutes

**Prerequisites:**

- GitHub Copilot subscription (Individual, Business, Pro or Enterprise)
- Node.js 22+ (for Copilot CLI via npm) or Homebrew
- Git clone of `aide`
- `jq` (`brew install jq`), and [mise](https://mise.jdx.dev) with a node for the shared tools (optional)

**Note:** Copilot CLI went [GA on February 25, 2026](https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/) and reads **CLAUDE.md** directly from the project root, which simplifies setup.

---

## Quick Start

```bash
# 1. Install Copilot CLI
npm install -g @github/copilot
# Or: brew install copilot-cli
# Or: curl -fsSL https://gh.io/copilot-install | bash

# 2. Install the configuration (scripts, custom instructions, skills)
cd aide/implementations/copilot
./install.sh
```

**Done!** Test with `copilot` in the terminal.

---

## Detailed installation

### Step 0: Install the Copilot CLI

```bash
# Via mise, which is how aide's other tools are kept current
mise use -g npm:@github/copilot@latest

# Or via npm (requires Node.js 22+)
npm install -g @github/copilot
```

---

### Step 1: Install the configuration (install.sh)

```bash
cd aide/implementations/copilot
./install.sh
```

**What does install.sh do?**
1. ✅ Installs every `core/scripts/aide-*` script and `upgrade-ai-tools` to `~/.local/bin/`, the shared tools through
   mise, and puts `~/.local/bin` on PATH
2. ✅ Installs `core/AGENTS.md` as global Copilot instructions in `~/.copilot/copilot-instructions.md`
3. ✅ Installs every skill in `core/skills/` to `~/.agents/skills/`
4. ✅ Verifies PATH and the GitHub Copilot extension

**⚠️ NOTE:** `core/AGENTS.md` is already built (`core/scripts/build-agents-md.sh`) and committed. Regular users do not need to rebuild it.

**Output (abridged):**
```text
🔧 GitHub Copilot Setup
=======================

1️⃣  Installing scripts to ~/.local/bin/...
   ✅ Installed: ~/.local/bin/aide-run-spec
   ✅ Installed: ~/.local/bin/aide-create-spec
   … one line per script, then the shared tools through mise

2️⃣  Installing global Copilot instructions...
   ✅ Installed: ~/.copilot/copilot-instructions.md

3️⃣  Installing skills to ~/.agents/skills/...
   ✅ Installed: ~/.agents/skills/ (all core/skills/)

4️⃣  Verifying PATH...
   ✅ ~/.local/bin is in PATH

5️⃣  Checking GitHub Copilot extension...
   ✅ GitHub Copilot extension is installed
```

---

### Step 2: Slash commands

No extra setup. Copilot CLI reads the same skills as Claude Code, so
`/aide-create`, `/aide-analyze`, `/aide-implement` and friends work natively in a
`copilot` session.

---

## Verification

### Test that everything works:

**1. Check the instructions file:**
```bash
head -3 ~/.copilot/copilot-instructions.md
```

**2. Test skills in Copilot CLI:**

```bash
cd ~/develop/my-app
copilot
/skills info aide-create
# Should show: Location: /Users/<you>/.agents/skills/aide-create/SKILL.md
```

---

## Updating the configuration

### When should you update?

- ✅ New slash commands added and pushed to git
- ✅ Changes to custom instructions pushed to git
- ✅ Pull/merge from the `main` branch

### How to update:

```bash
# 1. Pull the latest changes
cd aide
git pull

# 2. Reinstall (globally)
cd implementations/copilot
./install.sh

# 3. Start a new session
# The instructions are read when a session starts
```

**⚠️ NOTE:** You do NOT need to regenerate the instructions - that has already been done by the Aide team and committed to git.

---

## For Aide developers

**If YOU work on Aide and need to update the Copilot instructions:**

```bash
# 1. Edit the source (shared rules or the Copilot sections)
vim core/rules/<rule>.md           # or core/agents-intro.md

# 2. Rebuild AGENTS.md
core/scripts/build-agents-md.sh

# 3. Commit and push
git add core/rules/ core/AGENTS.md
git commit -m "Updated Copilot instructions"
git push
```

**Regular users** should NOT do this - they get the finished `AGENTS.md` via git.

---

## Important limitations

### Permission prompts (Copilot CLI)

Copilot CLI asks for permission for file operations and command execution.

**Solutions:**

1. **Interactive:** Choose "Yes, and approve all for the rest of the running session"
2. **CLI flags:** Start with `copilot --allow-all-tools` for the whole session
3. **Permanent:** Configure `~/.copilot/config.json` with `trusted_folders`
4. **Full auto:** `copilot --yolo` (only in isolated environments!)

See [README.md](./README.md#limitations) for the complete flag reference.

---

## Comparison with Claude Code

| Feature                     | Claude Code                       | Copilot CLI                                                  |
|-----------------------------|-----------------------------------|--------------------------------------------------------------|
| **Slash commands / Skills** | ✅ Native `/aide-create`          | ✅ Native in the CLI (reads `~/.claude/commands/` as skills) |
| **Custom instructions**     | ✅ Auto-read CLAUDE.md            | ✅ Auto-read CLAUDE.md + copilot-instructions.md             |
| **Permissions**             | ✅ Pre-approval via settings.json | ✅ config.json + CLI flags                                   |
| **Plan mode**               | ✅ Native                         | ✅ Native (Shift+Tab in the CLI)                             |
| **Headless runs**           | ✅ `claude -p`                    | ✅ `copilot -p`                                              |
| **Models**                  | The Claude family                 | Claude, GPT                                                  |
| **Setup**                   | ✅ `install.sh`                   | ✅ `install.sh`                                              |

**Conclusion:**

- Both use the same rules from `core/rules/`
- Copilot CLI reads CLAUDE.md directly — simpler setup than before
- Copilot shares its skills directory with Codex
- Claude Code has a better skills system and specialized agents

---

## Troubleshooting

### Problem: Custom instructions are not loaded

**Solution:**
1. Run `implementations/copilot/install.sh` again (installs `~/.copilot/copilot-instructions.md`)
2. Check that the file exists: `cat ~/.copilot/copilot-instructions.md`
3. Start a new Copilot session

---

## Further reading

- `README.md` - User guide for Copilot
- `../../core/skills/workflows/SKILL.md` - The spec workflow
- `../../DEVELOPING.md` - Developer guide for Aide

---

**Good luck with GitHub Copilot! 🚀**
