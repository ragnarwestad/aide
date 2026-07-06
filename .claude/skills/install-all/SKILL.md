---
name: install-all
description: >-
  Installer doc-aide for alle AI-verktøy (Claude Code, Copilot, Codex, Gemini).
  Kjører install-all.sh, som kaller hver implementations/<ai>/install.sh.
  Use when: skal installere eller oppdatere doc-aide for alle verktøy, har
  endret skills eller regler og vil installere på nytt.
  Do NOT use for: avinstallering (bruk /uninstall-all). Bare én AI? Kjør
  implementations/<ai>/install.sh direkte.
disable-model-invocation: true
---

# Installer doc-aide (alle AI-verktøy)

Kjør orkestratoren fra repo-roten:

```bash
./install-all.sh
```

Den kjører hver AI-implementasjons egen `install.sh`. Hver installer er
selvstendig og setter opp:

- **Felles:** scripts fra `core/scripts/` → `~/.local/bin/`
  (`aide-generate-pdf`, `aide-generate-html`, `mise-upgrade-ai-tools`)
- **Claude Code:** skills, agents, regler → `~/.claude/`, LSP-plugins
- **Copilot:** `AGENTS.md` → `~/.copilot/`, keybindings
- **Codex:** CLI-wrappers, custom instructions, MCP-servere
- **Gemini:** `GEMINI.md`, prosjektkonfig, MCP-servere

De felles scriptene kopieres av hver installer — bevisst, så `implementations/<ai>/install.sh`
alene gir alt den AI-en trenger.

**Bare én AI?** Kjør dens script direkte, f.eks. `implementations/codex/install.sh`.

Hvis nye skills ikke vises umiddelbart, restart Claude Code.
