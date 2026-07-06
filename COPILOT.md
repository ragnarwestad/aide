# COPILOT.md

This file is the entry point for GitHub Copilot when working in this repository.

**📍 Deployment:** This file is for humans setting up VS Code with Copilot.

## 📍 Where you are now

You are in **doc-aide**. This is an AI tooling workspace for AI-assisted development.

---

## 🚀 Setup for GitHub Copilot

### 1. Install VS Code extensions

Open the workspace in VS Code - you will be prompted to install the recommended extensions (`.vscode/extensions.json`):
- GitHub Copilot
- GitHub Copilot Chat
- Markdown linting
- ESLint, Prettier, Python

### 2. Workspace Trust

The first time you open the workspace in VS Code:
1. Click "Trust Workspace" (required for tasks to work)
2. This gives Copilot access to all files in the workspace

### 3. Verify configuration

**Check that custom instructions are loaded:**
1. Open Copilot Chat (`Cmd+Shift+I` / `Ctrl+Shift+I`)
2. Click "..." → "Settings"
3. Verify that `.github/copilot-instructions.md` is listed under "Instructions"

**Check environment variables:**
```bash
# In the VS Code terminal (Ctrl+` / Cmd+`)
echo $AIDE_INSTALLATION_PATH
# Should print: /Users/[your-user]/develop/doc-aide

echo $PATH | grep ".local/bin"
# Should contain: ~/.local/bin
```

### 4. Test tasks

**Run a task:**
1. `Cmd+Shift+P` / `Ctrl+Shift+P` → "Tasks: Run Task"
2. Pick a task (e.g. "Test: Run all tests")

---

## 🔍 Pre-PR Review Workflow

**Review your code BEFORE creating a PR:**

### Method 1: Use GitHub Copilot CLI

```bash
# Ask Copilot to review your changes
? Review my changes against the project's coding standard

# Or more specifically:
? Run a pre-PR review: check security, performance, accessibility and the project coding standard
```

### Method 2: Manual review command

```bash
# See what has changed
git status
git diff

# Ask Copilot for a review
? Review this diff
```

### What gets reviewed?

Copilot checks:
- ✅ **Coding standard** - TypeScript, React, testing
- ✅ **Security** - XSS, secrets, input validation
- ✅ **Performance** - Unnecessary re-renders, inefficient loops
- ✅ **Accessibility** - ARIA, semantic HTML, keyboard navigation
- ✅ **Testing** - Test coverage, TDD principles
- ✅ **Git** - Commit structure, file handling

### Example review request

```text
? I have made changes in UserForm.tsx and userService.ts.
  Can you review them against the coding standard before I commit?
  Focus in particular on:
  - Form validation
  - Error handling
  - Accessibility
```

---

## 🛠️ VS Code Tasks

**Run a task:**
1. `Cmd+Shift+P` / `Ctrl+Shift+P` → "Tasks: Run Task"
2. Pick the task you want
3. Follow the instructions in the terminal

**Available tasks:**
- `Aide: Create JIRA documentation` - Create document structure
- `Test: Run all tests` - Full test suite
- `Test: Run specific test file` - Run a single test file
- `QA: TypeScript check` - Type checking
- `QA: ESLint` - Linting
- `QA: Full quality check` - All of the above in sequence

---

## 🤖 How to use Copilot in this workspace

### Agent Mode (recommended)

Copilot's Agent Mode can follow multi-step workflows autonomously:

**Example: Analyze a JIRA issue**
```text
@workspace Analyze PROJ-7890 in Agent Mode.
Follow "Autonomous workflows" from the custom instructions.
```

Copilot will then:
1. Create the document structure
2. Analyze the codebase
3. Update 2-analysis.md and 3-solution.md
4. Stage files with git

### Natural Language Commands

Instead of slash commands (like Claude Code), use natural language:

| Claude Code | Copilot equivalent |
|-------------|-------------------|
| `/aide-create PROJ-7890` | "Create documentation for PROJ-7890" |
| `/aide-analyze PROJ-7890` | "Analyze PROJ-7890" |
| `/aide-implement PROJ-7890` | "Implement PROJ-7890 with TDD" |

### Use Tasks for repetitive commands

For commands you run often:
1. `Cmd+Shift+P` → "Tasks: Run Task"
2. Or set up keyboard shortcuts (see below)

---

## ⌨️ Recommended keyboard shortcuts

Add to your `keybindings.json` (File → Preferences → Keyboard Shortcuts → Open Keyboard Shortcuts JSON):

```json
[
  {
    "key": "cmd+k cmd+j",
    "command": "workbench.action.tasks.runTask",
    "args": "Aide: Create JIRA documentation"
  },
  {
    "key": "cmd+k cmd+a",
    "command": "workbench.action.tasks.runTask",
    "args": "QA: Full quality check"
  },
  {
    "key": "cmd+k cmd+t",
    "command": "workbench.action.tasks.runTask",
    "args": "Test: Run all tests"
  }
]
```

---

## 📁 Documentation structure

- **JIRA tickets:** `reports/<NN>-{ISSUE_ID}-slug/`
  - `1-description.md`, `2-analysis.md`, `3-solution.md`, `4-status.md`
  - **NOTE:** If `AIDE_REPORTS_PATH` is set, reports are written there instead
- **Todo plans:** `reports/`
- **Generic workflows:** `core/rules/`

---

## 🚫 CRITICAL: Copilot-specific rules

### Commit handling

**Copilot CANNOT run `git commit` directly.**

**When you ask Copilot to commit:**
1. Copilot will run `git status`
2. Copilot will run `git add <file>` for new files
3. Copilot will **give you the commit message** as text
4. **YOU must run `git commit` yourself** in the terminal

**Commit message format:** See [core/rules/git.md](core/rules/git.md)

### MCP Servers (Model Context Protocol)

If available via Copilot extensions:
- MCP server for JIRA - fetch JIRA data
- MCP server for Confluence - documentation lookups

---

## 🛠️ Most used commands

**Via Copilot Chat (natural language):**

```text
# JIRA workflow
"Create documentation for PROJ-7890"
"Analyze PROJ-7890"
"Implement PROJ-7890 with TDD"

# TODO workflow
"Create a TODO plan for the Redux Form migration"
"Analyze TODO-01"
"Implement TODO-01"

# Other tasks
"Convert UserProfile.tsx to a functional component"
"Create tests for validateForm"
```

**Via VS Code Tasks (Command Palette):**
- `Tasks: Run Task` → "Aide: Create JIRA documentation"
- `Tasks: Run Task` → "QA: Full quality check"
- `Tasks: Run Task` → "Test: Run all tests"

---

## 🔗 Further reading

**Must read before use:**
- ✅ [core/rules/workflows.md](core/rules/workflows.md) - JIRA/TODO workflows
- ✅ [core/rules/git.md](core/rules/git.md) - Git best practices
- ✅ [core/rules/testing.md](core/rules/testing.md) - Testing rules

**Copilot-specific documentation:**
- ✅ [implementations/copilot/README.md](implementations/copilot/README.md) - Copilot setup guide
- ✅ [core/AGENTS.md](core/AGENTS.md) - Instructions (installed to ~/.copilot/copilot-instructions.md)

**For a complete workspace overview:**
- 📄 [README.md](README.md) - Workspace overview

---

## 💡 Tips and tricks

### 1. Use @workspace for context

```text
@workspace Find all components that use redux-form
```

Copilot gets access to the entire codebase (not just the open file).

### 2. Be specific about the phase

```text
Analyze PROJ-7890, but STOP after the analysis.
Do NOT implement yet - I need to approve the plan first.
```

### 3. Reference documentation explicitly

```text
Follow the TDD process from core/rules/testing.md:
RED → GREEN → REFACTOR with a pause between each phase.
```

### 4. Use Agent Mode for complex tasks

Enable Agent Mode in Copilot Chat:
- Click the "agent" dropdown
- Or start the prompt with "@workspace" for automatic agent detection

---

## 🔄 Comparison with Claude Code

| Feature | Claude Code | Copilot (VS Code) |
|---------|-------------|-------------------|
| **Commands** | `/aide-create` | Natural language or Tasks |
| **Instructions** | `CLAUDE.md` (auto-read) | `.github/copilot-instructions.md` |
| **Permissions** | Fine-grained in settings.json | Workspace Trust (all-or-nothing) |
| **Bash commands** | Direct execution (pre-approved) | Via Tasks or manual terminal |
| **Git commit** | Blocked (deny list) | Copilot cannot run it (must be done manually) |
| **Agent Mode** | Built-in | Built-in (since 2024) |
| **MCP support** | ✅ | ✅ (via extensions) |

---

**Good luck with GitHub Copilot! 🚀**
