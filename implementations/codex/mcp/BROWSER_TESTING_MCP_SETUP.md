# Browser Testing MCP Servers Setup for Codex

**Playwright & Chrome DevTools MCP Servers**

## Innholdsfortegnelse

- [Oversikt](#oversikt)
- [Playwright MCP Server](#playwright-mcp-server)
- [Chrome DevTools MCP Server](#chrome-devtools-mcp-server)
- [Konfigurering](#konfigurering)
  - [Automatisk konfigurasjon (via install.sh)](#automatisk-konfigurasjon-via-installsh)
  - [Manuell konfigurasjon](#manuell-konfigurasjon)
- [Verifisering](#verifisering)
  - [1. Start frontend-appen](#1-start-frontend-appen)
  - [2. Restart Codex](#2-restart-codex)
  - [3. Test Playwright](#3-test-playwright)
  - [4. Test Chrome DevTools](#4-test-chrome-devtools)
- [Bruk](#bruk)
  - [Use case 1: Debugging](#use-case-1-debugging)
  - [Use case 2: Test-generering](#use-case-2-test-generering)
  - [Use case 3: Accessibility-analyse](#use-case-3-accessibility-analyse)
  - [Use case 4: Performance-analyse](#use-case-4-performance-analyse)
- [Feilsøking](#feilsøking)
  - ["Cannot connect to browser"](#cannot-connect-to-browser)
  - ["Page not loading"](#page-not-loading)
  - ["MCP server not found"](#mcp-server-not-found)
- [Referanser](#referanser)

---

## Oversikt

Disse MCP serverne gir Codex mulighet til å interagere med nettleseren for testing og debugging.

**Playwright MCP:**
- Browser automatisering (navigere, klikke, fylle ut forms)
- Generere E2E tester
- Accessibility tree analyse
- UI-verifisering

**Chrome DevTools MCP:**
- Console logs og errors
- Network tab (API-kall, CORS, timing)
- Performance tracing (LCP, CLS, FCP)
- DOM/CSS inspeksjon

---

## Playwright MCP Server

[Playwright MCP Server](https://github.com/microsoft/playwright-mcp) fra Microsoft.

**Forutsetninger:**
- Node.js 18 eller nyere

---

## Chrome DevTools MCP Server

[Chrome DevTools MCP Server](https://developer.chrome.com/blog/chrome-devtools-mcp) fra Google Chrome-teamet.

**Forutsetninger:**
- Chrome browser

---

## Konfigurering

### Automatisk konfigurasjon (via install.sh)

Kjør installasjonsskriptet:
```bash
cd implementations/codex
./install.sh
```

Scriptet legger automatisk til Playwright og Chrome DevTools i MCP-konfigurasjonen.

### Manuell konfigurasjon

Legg til i `~/.codex/config.toml`:

```toml
[mcp]

# Playwright MCP Server
[[mcp.servers]]
name = "playwright"
command = "npx"
args = ["@playwright/mcp@latest"]

# Chrome DevTools MCP Server
[[mcp.servers]]
name = "chrome-devtools"
command = "npx"
args = ["chrome-devtools-mcp@latest"]
```

**Tips:** Hvis du vil unngå at npx laster ned hver gang, installer globalt:
```bash
npm install -g @playwright/mcp chrome-devtools-mcp
```

Og oppdater config:
```toml
[[mcp.servers]]
name = "playwright"
command = "playwright-mcp"

[[mcp.servers]]
name = "chrome-devtools"
command = "chrome-devtools-mcp"
```

---

## Verifisering

### 1. Start frontend-appen

```bash
cd <ditt-frontend-prosjekt>
pnpm run dev
```

### 2. Restart Codex

For å laste inn nye MCP servers.

### 3. Test Playwright

```text
Bruk Playwright MCP til å:
1. Åpne http://localhost:3000
2. Verifiser at siden laster
3. Rapporter hva du ser
```

### 4. Test Chrome DevTools

```text
Bruk Chrome DevTools MCP til å:
1. Åpne http://localhost:3000
2. Vis console logs
3. Analyser network requests
```

---

## Bruk

### Use case 1: Debugging

```text
Jeg har en bug i PROJ-7890 hvor brukerdata ikke vises.
Bruk Chrome DevTools til å finne årsaken.
```

### Use case 2: Test-generering

```text
Generer en Playwright test som verifiserer at brukerprofil-siden
viser navn, e-post og rolle korrekt.
```

### Use case 3: Accessibility-analyse

```text
Analyser accessibility på /bruker/123 med Playwright og rapporter problemer.
```

### Use case 4: Performance-analyse

```text
Kjør performance trace på forsiden med Chrome DevTools og identifiser treghet.
```

---

## Feilsøking

### "Cannot connect to browser"

```bash
# Installer Playwright browsers
npx playwright install

# Restart Codex
```

### "Page not loading"

```bash
# Start frontend-appen
cd <ditt-frontend-prosjekt>
pnpm run dev
```

### "MCP server not found"

1. Sjekk at `~/.codex/config.toml` inneholder playwright og chrome-devtools
2. Restart Codex

---

## Referanser

- [Playwright MCP Server (GitHub)](https://github.com/microsoft/playwright-mcp)
- [Chrome DevTools MCP Server (Blog post)](https://developer.chrome.com/blog/chrome-devtools-mcp)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Codex README](../README.md)
