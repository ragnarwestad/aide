# Context7 MCP Server Setup for Gemini

**Oppdatert dokumentasjon for biblioteker og frameworks**

---

## Innholdsfortegnelse

- [Oversikt](#oversikt)
  - [Hva er Context7?](#hva-er-context7)
  - [Hvorfor bruke Context7?](#hvorfor-bruke-context7)
- [Installasjon](#installasjon)
  - [Automatisk konfigurasjon (via install.sh)](#automatisk-konfigurasjon-via-installsh)
  - [Manuell konfigurasjon](#manuell-konfigurasjon)
- [Bruk](#bruk)
  - [Grunnleggende bruk](#grunnleggende-bruk)
  - [Spesifiser bibliotek og versjon](#spesifiser-bibliotek-og-versjon)
- [Relevante biblioteker for doc-aide](#relevante-biblioteker-for-doc-aide)
  - [Frontend](#frontend)
  - [Backend](#backend)
  - [Testing](#testing)
- [Eksempler](#eksempler)
  - [Material UI](#material-ui)
  - [React Hooks](#react-hooks)
  - [Spring Boot](#spring-boot)
- [Feilsøking](#feilsøking)
  - [Context7 svarer ikke](#context7-svarer-ikke)
  - [Finner ikke bibliotek](#finner-ikke-bibliotek)
- [Referanser](#referanser)

---

## Oversikt

### Hva er Context7?

Context7 er en MCP server fra Upstash som gir Gemini tilgang til **oppdatert, versjonsspesifikk dokumentasjon** for biblioteker og frameworks.

### Hvorfor bruke Context7?

**For doc-aide:**
- ✅ Alltid oppdatert info om UI-biblioteker
- ✅ Korrekte React/TypeScript patterns
- ✅ Spring Boot / Kotlin best practices
- ✅ Unngå deprecated APIs

---

## Installasjon

### Automatisk konfigurasjon (via install.sh)

Kjør installasjonsskriptet:
```bash
cd implementations/gemini
./install.sh
```

Scriptet tilbyr å legge til Context7 MCP automatisk.

### Manuell konfigurasjon

Legg til i `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```

**Restart Gemini** for å laste inn MCP server.

---

## Bruk

### Grunnleggende bruk

Legg til `use context7` i prompts:

```text
Lag en React component med Material UI buttons, use context7
```

### Spesifiser bibliotek og versjon

```text
Refaktorer til React 19, use context7 for react@19
```

---

## Relevante biblioteker for doc-aide

### Frontend
- `react` - React core
- `@mui/material` - Material UI
- `react-hook-form` - Forms

### Backend
- `spring-boot` - Spring Boot
- `kotlin` - Kotlin
- `spring-data-jpa` - Database

### Testing
- `vitest` - Testing
- `@testing-library/react` - React testing

---

## Eksempler

### Material UI

```text
Lag en form med TextField og Button fra Material UI, use context7 for @mui/material
```

### React Hooks

```text
Optimaliser med React 19 hooks, use context7 for react@19
```

### Spring Boot

```text
Lag REST endpoint med validation, use context7 for spring-boot
```

---

## Feilsøking

### Context7 svarer ikke

1. Sjekk `~/.gemini/settings.json`
2. Restart Gemini
3. Prøv igjen

### Finner ikke bibliotek

- Bruk offisielt navn (f.eks. `@navikt/ds-react`)
- Sjekk om det finnes på npm

---

## Referanser

- [Context7 offisiell side](https://context7.com/)
- [Context7 MCP dokumentasjon](https://upstash.com/blog/context7-mcp)
- [Gemini README](../README.md)
