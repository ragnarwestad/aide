---
name: uninstall-all
description: >-
  Uninstall doc-aide for all AI tools (Claude Code, Copilot, Codex, Gemini).
  Runs uninstall-all.sh, which calls each implementations/<ai>/uninstall.sh.
  Use when: removing doc-aide from the machine, cleaning up before a fresh install.
  Do NOT use for: installing (use /install-all). Just one AI? Run
  implementations/<ai>/uninstall.sh directly.
disable-model-invocation: true
---

# Uninstall doc-aide (all AI tools)

Run the orchestrator from the repo root:

```bash
./uninstall-all.sh
```

It runs each AI implementation's own `uninstall.sh`, which reverses what the
respective `install.sh` did. Each installer **asks for its own confirmation** before
deleting anything (so you get one yes/no question per AI).

**Just one AI?** Run its script directly, e.g. `implementations/codex/uninstall.sh`.

If removed skills still show up, restart Claude Code.
