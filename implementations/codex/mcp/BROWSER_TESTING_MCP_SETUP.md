# Browser Testing MCP Servers Setup for Codex

**Playwright & Chrome DevTools MCP Servers**

## Table of Contents

- [Overview](#overview)
- [Playwright MCP Server](#playwright-mcp-server)
- [Chrome DevTools MCP Server](#chrome-devtools-mcp-server)
- [Configuration](#configuration)
  - [Automatic configuration (via install.sh)](#automatic-configuration-via-installsh)
  - [Manual configuration](#manual-configuration)
- [Verification](#verification)
  - [1. Start the frontend app](#1-start-the-frontend-app)
  - [2. Restart Codex](#2-restart-codex)
  - [3. Test Playwright](#3-test-playwright)
  - [4. Test Chrome DevTools](#4-test-chrome-devtools)
- [Usage](#usage)
  - [Use case 1: Debugging](#use-case-1-debugging)
  - [Use case 2: Test generation](#use-case-2-test-generation)
  - [Use case 3: Accessibility analysis](#use-case-3-accessibility-analysis)
  - [Use case 4: Performance analysis](#use-case-4-performance-analysis)
- [Troubleshooting](#troubleshooting)
  - ["Cannot connect to browser"](#cannot-connect-to-browser)
  - ["Page not loading"](#page-not-loading)
  - ["MCP server not found"](#mcp-server-not-found)
- [References](#references)

---

## Overview

These MCP servers let Codex interact with the browser for testing and debugging.

**Playwright MCP:**
- Browser automation (navigate, click, fill out forms)
- Generate E2E tests
- Accessibility tree analysis
- UI verification

**Chrome DevTools MCP:**
- Console logs and errors
- Network tab (API calls, CORS, timing)
- Performance tracing (LCP, CLS, FCP)
- DOM/CSS inspection

---

## Playwright MCP Server

[Playwright MCP Server](https://github.com/microsoft/playwright-mcp) from Microsoft.

**Prerequisites:**
- Node.js 18 or newer

---

## Chrome DevTools MCP Server

[Chrome DevTools MCP Server](https://developer.chrome.com/blog/chrome-devtools-mcp) from the Google Chrome team.

**Prerequisites:**
- Chrome browser

---

## Configuration

### Automatic configuration (via install.sh)

Run the installation script:
```bash
cd implementations/codex
./install.sh
```

The script automatically adds Playwright and Chrome DevTools to the MCP configuration.

### Manual configuration

Add to `~/.codex/config.toml`:

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

**Tip:** If you want to avoid npx downloading every time, install globally:
```bash
npm install -g @playwright/mcp chrome-devtools-mcp
```

And update the config:
```toml
[[mcp.servers]]
name = "playwright"
command = "playwright-mcp"

[[mcp.servers]]
name = "chrome-devtools"
command = "chrome-devtools-mcp"
```

---

## Verification

### 1. Start the frontend app

```bash
cd <your-frontend-project>
pnpm run dev
```

### 2. Restart Codex

To load the new MCP servers.

### 3. Test Playwright

```text
Use the Playwright MCP to:
1. Open http://localhost:3000
2. Verify that the page loads
3. Report what you see
```

### 4. Test Chrome DevTools

```text
Use the Chrome DevTools MCP to:
1. Open http://localhost:3000
2. Show console logs
3. Analyze network requests
```

---

## Usage

### Use case 1: Debugging

```text
I have a bug in PROJ-7890 where user data is not displayed.
Use Chrome DevTools to find the cause.
```

### Use case 2: Test generation

```text
Generate a Playwright test that verifies that the user profile page
displays name, email and role correctly.
```

### Use case 3: Accessibility analysis

```text
Analyze accessibility on /user/123 with Playwright and report issues.
```

### Use case 4: Performance analysis

```text
Run a performance trace on the front page with Chrome DevTools and identify slowness.
```

---

## Troubleshooting

### "Cannot connect to browser"

```bash
# Install Playwright browsers
npx playwright install

# Restart Codex
```

### "Page not loading"

```bash
# Start the frontend app
cd <your-frontend-project>
pnpm run dev
```

### "MCP server not found"

1. Check that `~/.codex/config.toml` contains playwright and chrome-devtools
2. Restart Codex

---

## References

- [Playwright MCP Server (GitHub)](https://github.com/microsoft/playwright-mcp)
- [Chrome DevTools MCP Server (Blog post)](https://developer.chrome.com/blog/chrome-devtools-mcp)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Codex README](../README.md)
