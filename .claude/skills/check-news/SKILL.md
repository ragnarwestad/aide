---
name: check-news
description: >-
  Sjekk AI-verktøy nyheter fra Anthropic, GitHub, Google og OpenAI.
  Henter changelogs og nyheter fra offisielle kilder, vurderer relevans
  for doc-aide, og oppdaterer nyhetsloggen.
  Use when: skal sjekke AI-nyheter, vil vite hva som er nytt i
  Claude Code/Copilot/Codex/Gemini, skal oppdatere nyhetsloggen.
  Do NOT use for: generelle spørsmål om AI-verktøy (bruk websøk direkte).
disable-model-invocation: true
---

# AI-nyheter: Sjekk og oppdater

Nyhetsloggen bor i doc-aide-repoet: `docs/AI_NYHETSLOGG.md`. Denne skillen
er repo-lokal og kjøres når du jobber i doc-aide.

## Steg 1: Finn nyhetsloggen

```bash
git -C ~/develop/doc-aide rev-parse --show-toplevel 2>/dev/null \
  && echo "$(git -C ~/develop/doc-aide rev-parse --show-toplevel)/docs/AI_NYHETSLOGG.md"
```

Les `docs/AI_NYHETSLOGG.md` og finn datoen for siste gjennomgang (øverste
overskrift under `## Nyhetslogg`).

## Steg 2: Hent nyheter fra kilder

Sjekk disse kildene for nyheter **siden siste gjennomgang**:

### Claude Code

1. WebFetch: `https://github.com/anthropics/claude-code/releases`
2. WebFetch: `https://www.anthropic.com/news`

### GitHub Copilot

1. WebFetch: `https://github.blog/changelog/label/copilot/`
2. WebFetch: `https://github.com/github/copilot-cli/releases`

### OpenAI Codex

1. WebFetch: `https://github.com/openai/codex/releases`
2. WebFetch: `https://developers.openai.com/codex/changelog/`

### Google Gemini CLI

1. WebFetch: `https://geminicli.com/docs/changelogs/`
2. WebFetch: `https://github.com/google-gemini/gemini-cli/releases`

## Steg 3: Filtrer og vurder

For hver nyhet, vurder:

- **Er den relevant for doc-aide?** (skills, hooks, agents, MCP, konfig)
- **Krever den handling?** (oppdatere ai-tools-reference.md, endre install.sh, nye skills)
- **Hvor viktig er den?** Bruk ikonene:
  - ⭐ Direkte påvirkning på doc-aide (krever handling)
  - ✅ Nyttig, men ingen umiddelbar handling
  - ℹ️ Informativt, lav relevans
  - ⚠️ Breaking change eller noe som må verifiseres

## Steg 4: Oppdater nyhetsloggen

Legg til ny seksjon i `docs/AI_NYHETSLOGG.md` under `## Nyhetslogg`, **over** de
eksisterende entries (nyeste først). Bruk dagens dato som overskrift, og legg
datoen til i innholdsfortegnelsen øverst.

Format — følg eksisterende mønster i filen:

```markdown
### YYYY-MM-DD

**Claude Code (periode):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|
| ... | ... | ... | [Kilde](url) |

**GitHub Copilot CLI (periode):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|

**OpenAI Codex CLI (periode):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|

**Gemini CLI (periode):**

| Dato | Versjon | Nyhet | Kilde |
|------|---------|-------|-------|

**Relevans for doc-aide:**

- ⭐ Viktige funn som krever handling
- ✅ Nyttige funn
- ℹ️ Informative funn
```

## Steg 5: Flagg forslag til matrise og referanse

Loggen destilleres videre inn i to dokumenter i repoet:

- `docs/AI_SUPPORT_MATRIX.md` — destillert nåtilstand (versjoner, mekanismer)
- `.claude/rules/ai-tools-reference.md` — verifisert config-referanse

For hvert ⭐- og ⚠️-funn i denne gjennomgangen: vurder om det endrer noe i disse
to dokumentene (ny versjon, ny/endret konfig-sti, ny mekanisme, breaking change).

**Ikke rediger dokumentene stille.** Vis i stedet en sjekkliste med konkrete
forslag, og **be brukeren godkjenne** før du redigerer:

```markdown
Foreslåtte endringer (godkjenn før jeg redigerer):

AI_SUPPORT_MATRIX.md:
- [ ] Oppdater versjon Claude Code → vX.Y.Z
- [ ] Legg til mekanisme: ...

ai-tools-reference.md:
- [ ] Oppdater skill-sti-tabell: ...
```

Når brukeren har godkjent, gjør **kirurgiske** endringer i de aktuelle filene.

## Steg 6: Oppsummer

Vis en kort oppsummering:
- Antall nye nyheter per verktøy
- Viktigste funn (⭐-markerte)
- Foreslåtte matrise/referanse-endringer som venter på godkjenning
