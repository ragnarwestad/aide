# Installation - Doc Aide

> **📝 Note:** For AI-specific installation, primarily see:
> - **Claude Code:** [implementations/claude-code/INSTALL.md](../implementations/claude-code/INSTALL.md)
> - **Copilot:** [implementations/copilot/INSTALL.md](../implementations/copilot/INSTALL.md)
>
> This guide provides a high-level overview.

Complete step-by-step guide for setting up the AI workspace with your preferred AI tool.

---

## Table of contents

- [Choose your AI tool](#choose-your-ai-tool)
- [General setup (all AI tools)](#general-setup-all-ai-tools)
  - [Step 1: Clone the AI workspace](#step-1-clone-the-ai-workspace)
  - [Step 2: JIRA data](#step-2-jira-data)
- [AI-tool-specific installation](#ai-tool-specific-installation)
  - [Install everything at once](#install-everything-at-once)
  - [Claude Code](#claude-code)
  - [GitHub Copilot](#github-copilot)
  - [Other AI tools](#other-ai-tools)
- [Verify the setup](#verify-the-setup)
- [Troubleshooting](#troubleshooting)

---

## Choose your AI tool

This workspace supports several AI tools. Choose the one that suits you best:

| AI tool            | Advantages                                          | Best for                                     | Installation documentation                                               |
|--------------------|----------------------------------------------------|----------------------------------------------|--------------------------------------------------------------------------|
| **Claude Code**    | Slash commands, specialized agents, 200K context   | Complex JIRA analyses, cross-cutting tasks   | [claude-code/README.md](../implementations/claude-code/README.md)         |
| **Codex (OpenAI)** | Prompt templates, manual workflow                  | JIRA/TODO analysis and implementation        | [../implementations/codex/README.md](../implementations/codex/README.md) |
| **GitHub Copilot** | Native VS Code, Agent Mode, fast responses         | Quick edits, refactoring, single-file work   | [copilot/README.md](../implementations/copilot/README.md)                 |

**💡 Tip:** You can use several AI tools at the same time! Choose the best tool for each task.

---

## General setup (all AI tools)

These steps apply regardless of which AI tool you use.

### Prerequisites

**You must have:**

- ✅ Git installed
- ✅ Access to NAV's JIRA: https://jira.example.com
- ✅ Your projects cloned and working

**Directory structure after setup:**

> **📝 Note:** The examples below use `~/develop/` as the base directory. You can use a different structure, but
> the workspace should live as a **sibling** of your projects for relative paths to work optimally.

```text
~/develop/          # Example - adapt to your structure
├── doc-aide/       # AI workspace (this repo)
├── my-app/         # example project
├── my-api/         # example project
└── ...             # other projects
```

---

### Step 1: Clone the AI workspace

Clone the workspace as a **sibling** of your projects (or wherever you prefer):

```bash
cd ~/develop/
git clone <repo-url> doc-aide
cd doc-aide
```

**Verify the structure:**

```bash
# You should be able to see both directories:
ls -la ~/develop/
# → doc-aide/
# → my-app/
```

---

### Step 2: JIRA data

JIRA data is fetched manually from https://jira.example.com and pasted in when the AI tool asks for it.

**No scripts or API integration required** - you copy the relevant info directly from the JIRA browser.

---

### Step 3: (Optional) Configure environment variables

These are **optional** but recommended for a better workflow. They apply to **all AI tools**.

#### AIDE_REPORTS_PATH

Store JIRA documents and TODO plans outside the workspace (e.g. in Dropbox/iCloud):

```bash
# In ~/.zshrc or ~/.bashrc
export AIDE_REPORTS_PATH="/Users/$(whoami)/Documents/aide-reports"
# or
export AIDE_REPORTS_PATH="/Users/$(whoami)/Dropbox/aide-reports"

# Load the changes
source ~/.zshrc  # or source ~/.bashrc
```

**Benefit:** Reports are not committed to the workspace repo and can be synced separately.

#### AIDE_INSTALLATION_PATH

Points to the workspace root (for templates and configuration):

```bash
# In ~/.zshrc or ~/.bashrc
export AIDE_INSTALLATION_PATH="/Users/$(whoami)/develop/doc-aide"

# Load the changes
source ~/.zshrc  # or source ~/.bashrc
```

**Benefit:** Scripts and templates find the workspace regardless of where you run them from.

#### AIDE_PROJECTS_PATH (Claude Code only)

Eliminates permission prompts in Claude Code:

```bash
# In ~/.zshrc or ~/.bashrc
export AIDE_PROJECTS_PATH="/Users/$(whoami)/develop"

# Load the changes
source ~/.zshrc  # or source ~/.bashrc
```

**Benefit:** Claude Code generates absolute paths in permissions, so you avoid approving every time.

---

**✅ General setup complete!**

You now have:
- ✅ Cloned the doc-aide workspace
- ✅ (Optional) Configured environment variables

**Next step:** Choose your AI tool and complete the installation 👇

---

## AI-tool-specific installation

Choose your AI tool and follow the relevant guide:

### Install everything at once

The easiest path is to install for all the AI tools at once, from the repo root:

```bash
./install-all.sh
```

It runs each AI implementation's own installer. Each installer is
**self-contained** and sets up both the shared scripts (`core/scripts/` → `~/.local/bin/`,
including `aide-generate-pdf`, `aide-generate-html` and `mise-upgrade-ai-tools`)
and its own AI-specific setup.

In Claude Code you can run the `/install-all` skill instead. `./uninstall-all.sh`
(or `/uninstall-all`) reverses everything — each installer asks for its own confirmation.

**Just one tool?** Run its installer directly — it provides everything that tool needs:

```bash
implementations/claude-code/install.sh
implementations/copilot/install.sh
implementations/codex/install.sh
implementations/gemini/install.sh
```

The sections below describe what each individual installer does.

### Claude Code

**Installation and setup:**

1. **Install the Claude Code CLI:**
   ```bash
   # See: https://docs.anthropic.com/claude-code/installation
   # Requires a Claude Pro/Team subscription
   ```

2. **Verify the installation:**
   ```bash
   claude --version
   # → Claude Code CLI version X.X.X
   ```

3. **Run the setup script:**
   ```bash
   cd doc-aide/implementations/claude-code
   ./install.sh
   ```

   **The script installs globally:**
    - ✅ Skills, agents and rules → `~/.claude/`
    - ✅ Scripts (incl. `mise-upgrade-ai-tools`) → `~/.local/bin/`
    - ✅ LSP plugins (typescript, kotlin, jdtls)

   **💡 Tip:** If you set environment variables in Step 3, run `source ~/.zshrc` before setup.

4. **Test the setup:**
   ```bash
   /aide-create PROJ-7637
   ```

**Full documentation:**

- **[implementations/claude-code/README.md](../implementations/claude-code/README.md)** - Setup guide and quick start

**Key features:**

- ✅ Slash commands (`/aide-create`, `/aide-analyze`, `/aide-implement`)
- ✅ Specialized agents (`@agent-jira-analyzer`, `@agent-tdd-implementer`)
- ✅ Automatic reading of CLAUDE.md at startup
- ✅ 200K token context window
- ✅ Automatic git staging

---

### GitHub Copilot

**Installation and setup:**

1. **Install Copilot in VS Code:**
   ```bash
   code --install-extension GitHub.copilot
   code --install-extension GitHub.copilot-chat
   ```

2. **Run the install script:**
   ```bash
   # From the workspace root
   implementations/copilot/install.sh
   ```
   It installs `AGENTS.md` as the global Copilot instructions
   (`~/.copilot/copilot-instructions.md`) and the shared scripts to `~/.local/bin/`.

3. **Enable Agent Mode:**
    - Open Copilot Chat in VS Code (`Ctrl+Shift+I` / `Cmd+Shift+I`)
    - Select **"agent"** from the chat mode dropdown
    - Configure tools via the tools button

4. **Test the setup:**
    - In the Copilot CLI: run `/aide-create PROJ-7637` (reads the same skills as Claude Code)

**Full documentation:**

- **[implementations/copilot/README.md](../implementations/copilot/README.md)** - Setup guide and quick start

**Key features:**

- ✅ Agent Mode for autonomous multi-step tasks
- ✅ Custom instructions (`.github/copilot-instructions.md`)
- ✅ Slash commands / skills (`/aide-create` etc. — same as Claude Code)
- ✅ Native VS Code integration (faster than the Claude CLI)
- ✅ Codebase analysis and test iteration

---

### Other AI tools

**Codex, or other AI tools:**

1. **See the Codex implementation:**
    - **[../implementations/codex/README.md](../implementations/codex/README.md)** - Setup guide for Codex
    - Run `implementations/codex/install.sh` (CLI wrappers + custom instructions)

2. **Add new AI tools:**
    - Follow the same pattern as Codex/Copilot
    - Create `implementations/<tool>/`
    - Reuse the `core/rules/` rules

3. **Use the generic workflows:**
    - Read `core/rules/workflows.md` for JIRA/TODO workflows
    - Follow `core/rules/testing.md` for TDD
    - Follow `core/rules/git.md` for git operations

4. **Manual JIRA creation:**
   ```bash
   # Create the directory
   mkdir -p reports/<NN>-PROJ-7637-slug/

   # Fill in the documentation based on the templates in core/templates/todo/
   # (Ask your AI tool for help - paste in the JIRA data manually)
   ```

**Key features:**

- ✅ Same workflows as Claude Code and Copilot
- ✅ Same 4-file document structure
- ❌ No native slash commands or agents
- ⚠️ Requires more manual prompt engineering

---

## Verify the setup

Regardless of which AI tool you use, test that the setup works:

### Test 1: Document creation

**With Claude Code:**

```bash
/aide-create PROJ-7637
```

**With Copilot:**

- Run `/aide-create PROJ-7637` in the Copilot CLI

**With other AI tools:**

- Ask the AI tool to create documentation based on `core/rules/workflows.md`
- Use the templates from `core/templates/todo/`

**Expected result:**

```bash
ls -la reports/<NN>-PROJ-7637-slug/
# → README.md
# → 1-description.md (filled in)
# → 2-analysis.md (empty)
# → 3-solution.md (empty)
# → 4-status.md (empty)
```

### Test 2: Codebase analysis (optional)

Test that the AI tool can analyze the codebase:

**With Claude Code:**

```bash
/aide-analyze PROJ-7637
```

**With Copilot:**

- Run `/aide-analyze PROJ-7637` in the Copilot CLI

**With other AI tools:**

- Ask for a codebase analysis based on `1-description.md`
- Follow the structure from `core/rules/workflows.md`

**Expected result:**

- `2-analysis.md` is filled in with affected files (file:line)
- `3-solution.md` contains an implementation plan with TDD structure
- `4-status.md` shows the initial status

---

## Troubleshooting

### Problem: AI tool does not follow the workflows

**Symptom:**

- Copilot skips TDD
- Claude Code ignores the git rules
- Documentation lacks the 4-file structure

**Solution:**

**For Claude Code:**

```bash
# Run the setup script again
cd doc-aide/implementations/claude-code
./install.sh
# Restart Claude Code
```

**For Copilot:**

```bash
# Reinstall
implementations/copilot/install.sh

# Restart VS Code / Copilot CLI
```

**For other AI tools:**

- Be more explicit in your prompts
- Refer directly to `core/rules/workflows.md`
- Ask for step-by-step execution

---

## Next steps

Once the setup is complete:

1. **Read the implementation documentation for your AI tool:**
    - [implementations/claude-code/README.md](../implementations/claude-code/README.md)
    - [implementations/copilot/README.md](../implementations/copilot/README.md)
    - [AI_DEVELOPMENT_GUIDE.md](./AI_DEVELOPMENT_GUIDE.md)

2. **Read the generic workflows:**
    - [core/rules/workflows.md](../core/rules/workflows.md)
    - [core/rules/documentation.md](../core/rules/documentation.md)

3. **Test with a real JIRA issue:**
    - Create the documentation
    - Analyze the codebase
    - Implement with TDD (optional)

4. **Explore further:**
    - Read README.md for the full overview
    - See [AI_DEVELOPMENT_GUIDE.md](./AI_DEVELOPMENT_GUIDE.md) for the architecture

---

**Good luck with AI-assisted development! 🚀**

**Choose your tool, follow the guide, and get started!**
