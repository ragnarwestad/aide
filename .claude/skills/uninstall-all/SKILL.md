---
name: uninstall-all
description: >-
  Avinstaller doc-aide for alle AI-verktøy (Claude Code, Copilot, Codex, Gemini).
  Kjører uninstall-all.sh, som kaller hver implementations/<ai>/uninstall.sh.
  Use when: skal fjerne doc-aide fra maskinen, skal rydde opp før ny installasjon.
  Do NOT use for: installering (bruk /install-all). Bare én AI? Kjør
  implementations/<ai>/uninstall.sh direkte.
disable-model-invocation: true
---

# Avinstaller doc-aide (alle AI-verktøy)

Kjør orkestratoren fra repo-roten:

```bash
./uninstall-all.sh
```

Den kjører hver AI-implementasjons egen `uninstall.sh`, som reverserer det
respektive `install.sh` gjorde. Hver installer **ber om egen bekreftelse** før
den sletter noe (så du får ett ja/nei-spørsmål per AI).

**Bare én AI?** Kjør dens script direkte, f.eks. `implementations/codex/uninstall.sh`.

Hvis fjernede skills fortsatt vises, restart Claude Code.
