---
name: install-all
description: >-
  Install doc-aide for all AI tools (Claude Code, Copilot, Codex, Gemini).
  Runs install-all.sh, which calls each implementations/<ai>/install.sh.
  Use when: installing or updating doc-aide for all tools, having
  changed skills or rules and wanting to reinstall.
  Do NOT use for: uninstalling (use /uninstall-all). Just one AI? Run
  implementations/<ai>/install.sh directly.
disable-model-invocation: true
---

# Install doc-aide (all AI tools)

Run the orchestrator from the repo root:

```bash
./install-all.sh
```

It runs each AI implementation's own `install.sh`. Each installer is
self-contained and sets up:

- **Shared:** scripts from `core/scripts/` → `~/.local/bin/`
  (`aide-generate-pdf`, `aide-generate-html`, `mise-upgrade-ai-tools`)
- **Claude Code:** skills, agents, rules → `~/.claude/`, LSP plugins
- **Copilot:** `AGENTS.md` → `~/.copilot/`, keybindings
- **Codex:** CLI wrappers, custom instructions, MCP servers
- **Gemini:** `GEMINI.md`, project config, MCP servers

The shared scripts are copied by each installer — deliberately, so `implementations/<ai>/install.sh`
alone provides everything that AI needs.

**Just one AI?** Run its script directly, e.g. `implementations/codex/install.sh`.

If new skills don't show up immediately, restart Claude Code.
