# Markdown Linting

## Innholdsfortegnelse

- [Oversikt](#oversikt)
- [Bruk](#bruk)
- [Konfigurasjon](#konfigurasjon)
- [Ansvar](#ansvar)
- [Vanlige feil og løsninger](#vanlige-feil-og-løsninger)
  - [MD029: List numbering](#md029-list-numbering)
  - [MD040: Missing code block language](#md040-missing-code-block-language)
  - [MD051: Broken anchor link](#md051-broken-anchor-link)
  - [Vanlig AI-feil: Kodeblokk-avslutning med språk](#vanlig-ai-feil-kodeblokk-avslutning-med-språk)

---

## Oversikt

Dette workspace bruker `markdownlint-cli2` via `npx` for å fange opp markdown-feil før de committes.

**Fokusområder:**
1. **List numbering (MD029)** - Numbered lists must restart at 1 after headers
2. **Anchor links (MD051)** - TOC links must match actual heading anchors
3. **Code block language (MD040)** - All code blocks must specify language (tsx, typescript, bash, etc.)

## Bruk

### Sjekk alle markdown-filer

```bash
npx markdownlint-cli2 '**/*.md'
```

### Automatisk fikse det som kan fikses

```bash
npx markdownlint-cli2 --fix '**/*.md'
```

## Konfigurasjon

Se `.markdownlint-cli2.jsonc` for reglene.

**Viktig:** Konfigurasjonen er minimal og fokuserer KUN på de kritiske issuene vi har hatt problemer med.

## Ansvar

**ALLE AI-implementasjoner (Claude Code, Cursor, Junie, Codex, etc.):**
- Må ALLTID kjøre linting på markdown-filer etter skriving/endring/flytting
- Må fikse alle MD029, MD040 og MD051 feil før oppgaven er ferdig
- Kommando: `npx markdownlint-cli2 <fil.md>` eller `npx markdownlint-cli2 '**/*.md'`

**Manuell sjekk (valgfritt):** Du kan kjøre linting for å dobbeltsjekke.

## Vanlige feil og løsninger

### MD029: List numbering

**Feil:**
```markdown
### My Header

3. First item
4. Second item
```

**Løsning:**
```markdown
### My Header

1. First item
2. Second item
```

### MD040: Missing code block language

**Feil:**
```markdown
\```
const foo = 'bar';
\```
```

**Løsning:**
```markdown
\```typescript
const foo = 'bar';
\```
```

**Viktig:** Bruk `tsx` for React/JSX code, ikke `typescript`.

### MD051: Broken anchor link

**Feil:**
```markdown
- [My Section](#my-section)

## 1. My Section
```

**Løsning:**
```markdown
- [My Section](#1-my-section)

## 1. My Section
```

Eller oppdater HTML anchor:
```markdown
<a id="my-section"></a>
## 1. My Section
```
til:
```markdown
<a id="1-my-section"></a>
## 1. My Section
```

### Vanlig AI-feil: Kodeblokk-avslutning med språk

**Feil (ikke fanget av linter, men bryter HTML-generering):**

````markdown
```bash
echo "Hello"
```text
````

**Løsning:**

````markdown
```bash
echo "Hello"
```
````

**Hvorfor dette skjer:**
- AI-assistenter (Claude, Copilot, etc.) skriver noen ganger ` ```text` som avslutning
- Dette er IKKE gyldig markdown - kodeblokker avsluttes ALLTID med bare ` ``` `
- Pandoc og andre konverterere tolker ` ```text` som START på ny kodeblokk
- Resultatet er ødelagt HTML med feil kodeblokker og brutte anchor-lenker

**Preventiv fix:**
- `aide-generate-html` scriptet retter dette automatisk
- Men kilden bør fikses - se [DOCUMENTATION_STANDARD.md](./DOCUMENTATION_STANDARD.md#kodeblokker)
