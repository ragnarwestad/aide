# Installation Guide - GitHub Copilot

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Detailed installation](#detailed-installation)
  - [Step 0: Copilot CLI and VS Code extensions](#step-0-install-copilot-cli-and-vs-code-extensions)
  - [Step 1: install.sh](#step-1-install-the-configuration-installsh)
  - [Step 2: Slash commands](#step-2-slash-commands)
- [Verification](#verification)
- [Updating the configuration](#updating-the-configuration)
- [For doc-aide developers](#for-doc-aide-developers)
- [Important limitations](#important-limitations)
- [Comparison with Claude Code](#comparison-with-claude-code)
- [Troubleshooting](#troubleshooting)
- [Further reading](#further-reading)

---

## Overview

This guide shows how to install the GitHub Copilot integration for the doc-aide workspace **for the first time**.

**Time required:** ~5 minutes

**Prerequisites:**

- GitHub Copilot subscription (Individual, Business, Pro or Enterprise)
- Node.js 22+ (for Copilot CLI via npm) or Homebrew
- Access to your JIRA instance (optional)
- Git clone of `doc-aide` (and optionally `my-app`, `my-api`, etc.)
- `AIDE_PROJECTS_PATH` environment variable set (see Quick Start)

**Note:** Copilot CLI went [GA on February 25, 2026](https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/) and reads **CLAUDE.md** directly from the project root, which simplifies setup.

---

## Quick Start

```bash
# 1. Install Copilot CLI
npm install -g @github/copilot
# Or: brew install copilot-cli
# Or: curl -fsSL https://gh.io/copilot-install | bash

# 2. Set AIDE_PROJECTS_PATH (REQUIRED)
export AIDE_PROJECTS_PATH="/Users/$(whoami)/develop"
echo 'export AIDE_PROJECTS_PATH="/Users/$(whoami)/develop"' >> ~/.zshrc

# 3. Install the configuration (scripts, custom instructions, VS Code setup)
cd doc-aide/implementations/copilot
./install.sh
```

**Done!** Test with `copilot` in the terminal.

---

## Detailed installation

### Step 0: Install Copilot CLI and VS Code extensions

**Copilot CLI (terminal):**

```bash
# Via npm (recommended, requires Node.js 22+)
npm install -g @github/copilot

# Via Homebrew
brew install copilot-cli

# Via curl (Linux/macOS)
curl -fsSL https://gh.io/copilot-install | bash
```

**VS Code extensions (optional, for Agent Mode in the IDE):**

```bash
# Install the GitHub Copilot extensions
code --install-extension GitHub.copilot
code --install-extension GitHub.copilot-chat
```

Or via VS Code:

1. Open Extensions (Cmd+Shift+X)
2. Search for "GitHub Copilot"
3. Install both extensions (Copilot + Copilot Chat)

---

### Step 1: Install the configuration (install.sh)

```bash
cd doc-aide/implementations/copilot
./install.sh
```

**What does install.sh do?**
1. ✅ Installs shared scripts to `~/.local/bin/`:
   - `aide-generate-pdf`, `aide-generate-html` - Document generation
   - `mise-upgrade-ai-tools` - Updates the AI CLIs
2. ✅ Installs `AGENTS.md` as global Copilot instructions in `~/.copilot/copilot-instructions.md`
3. ✅ Verifies PATH and the GitHub Copilot extension
4. ✅ Installs JetBrains Live Templates (if a JetBrains IDE is found)

**⚠️ NOTE:** `core/AGENTS.md` is already built (`core/scripts/build-agents-md.sh`) and committed. Regular users do not need to rebuild it.

**Output:**
```text
🔧 GitHub Copilot Setup
=======================

1️⃣  Installing scripts to ~/.local/bin/...
   ✅ Installed: ~/.local/bin/aide-generate-pdf
   ✅ Installed: ~/.local/bin/aide-generate-html
   ✅ Installed: ~/.local/bin/mise-upgrade-ai-tools

2️⃣  Installing global Copilot instructions...
   ✅ Installed: ~/.copilot/copilot-instructions.md

3️⃣  Verifying PATH...
   ✅ ~/.local/bin is in PATH

4️⃣  Checking GitHub Copilot extension...
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

**1. Open a project in VS Code:**
```bash
cd $AIDE_PROJECTS_PATH/my-app
code .
```

**2. Check custom instructions:**
- Open Copilot Chat (`Cmd+Shift+I`)
- Click "..." → "Settings"
- Verify that `.github/copilot-instructions.md` is listed under "Instructions"

**3. Test skills in Copilot CLI:**

```bash
copilot
/skills info aide-create
# Should show: Location: /Users/<you>/.claude/commands/aide-create.md
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
cd doc-aide
git pull

# 2. Reinstall (globally)
cd implementations/copilot
./install.sh

# 3. Restart VS Code
# Close and reopen VS Code for the changes to take effect
```

**⚠️ NOTE:** You do NOT need to regenerate the instructions - that has already been done by the doc-aide team and committed to git.

---

## For doc-aide developers

**If YOU work on doc-aide and need to update the Copilot instructions:**

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

| Feature | Claude Code | Copilot CLI / VS Code |
|---------|-------------|----------------------|
| **Slash commands / Skills** | ✅ Native `/aide-create` | ✅ Native in the CLI (reads `~/.claude/commands/` as skills) |
| **Custom instructions** | ✅ Auto-read CLAUDE.md | ✅ Auto-read CLAUDE.md + copilot-instructions.md |
| **Permissions** | ✅ Pre-approval via settings.json | ✅ config.json + CLI flags |
| **Plan mode** | ✅ Native | ✅ Native (Shift+Tab in the CLI) |
| **IDE integration** | ⚠️ Via CLI | ✅ Native VS Code |
| **Agent Mode** | ✅ Autonomous workflows | ✅ Autonomous workflows |
| **Models** | The Claude family | Claude, GPT, Gemini |
| **Setup** | ✅ `install.sh` | ✅ `install.sh` |

**Conclusion:**

- Both use the same rules from `core/rules/`
- Copilot CLI reads CLAUDE.md directly — simpler setup than before
- Copilot is better integrated in VS Code
- Claude Code has a better skills system and specialized agents

---

## Troubleshooting

### Problem: Custom instructions are not loaded

**Solution:**
1. Run `implementations/copilot/install.sh` again (installs `~/.copilot/copilot-instructions.md`)
2. Check that the file exists: `cat ~/.copilot/copilot-instructions.md`
3. Restart Copilot CLI / VS Code

---

## Further reading

- `README.md` - User guide for Copilot
- `../../COPILOT.md` - Quick start guide (workspace root)
- `../../core/rules/workflows.md` - JIRA/TODO workflows
- `../../DEVELOPING.md` - Developer guide for doc-aide

---

**Good luck with GitHub Copilot! 🚀**
