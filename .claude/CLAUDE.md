# CLAUDE.md - doc-aide

doc-aide er et konfigurasjons- og verktøyrepo for AI-assistert utvikling.
Det er IKKE en applikasjon i seg selv.

---

## Viktig: To roller — ikke forveksle dem

**Rolle 1 — Utviklingsmiljø:** Vi bruker kun Claude Code til å jobbe med
dette repoet. Claude Code-konfig for dette repoet lever i `.claude/`.
Andre AI-verktøy (Copilot, Codex, Gemini) brukes ikke for utvikling her.

**Rolle 2 — Produkt:** `implementations/` inneholder kildekode vi bygger
og installerer til andre prosjekter. Det finnes implementasjoner
for Claude Code, Copilot, Codex og Gemini.

**Prioritering av implementasjoner:**
1. **Copilot** — viktigst
2. **Claude Code** — viktig nr 2
3. Codex og Gemini — lavere prioritet

---

## Viktige regler

**aide-* er skills (slash commands), ikke CLI-scripts.**
`/aide-create`, `/aide-analyze`, `/aide-implement` etc. kjøres inne i Claude Code eller Copilot.
Kun `aide-generate-pdf` og `aide-generate-html` finnes som CLI-scripts (de kjører pandoc).

Se `.claude/rules/development.md` for katalogstruktur, installasjonsoversikt
og hvordan legge til ny funksjonalitet.
