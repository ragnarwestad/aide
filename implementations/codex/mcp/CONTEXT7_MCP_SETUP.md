# Context7 MCP Server Setup for Codex

**Up-to-date documentation for libraries and frameworks**

---

## Table of Contents

- [Overview](#overview)
  - [What is Context7?](#what-is-context7)
  - [Why use Context7?](#why-use-context7)
- [Installation](#installation)
  - [Automatic configuration (via install.sh)](#automatic-configuration-via-installsh)
  - [Manual configuration](#manual-configuration)
- [Usage](#usage)
  - [Basic usage](#basic-usage)
  - [Specify library and version](#specify-library-and-version)
- [Relevant libraries for doc-aide](#relevant-libraries-for-doc-aide)
  - [Frontend](#frontend)
  - [Backend](#backend)
  - [Testing](#testing)
- [Examples](#examples)
  - [Material UI](#material-ui)
  - [React Hooks](#react-hooks)
  - [Spring Boot](#spring-boot)
- [Troubleshooting](#troubleshooting)
  - [Context7 does not respond](#context7-does-not-respond)
  - [Library not found](#library-not-found)
- [References](#references)

---

## Overview

### What is Context7?

Context7 is an MCP server from Upstash that gives Codex access to **up-to-date, version-specific documentation** for libraries and frameworks.

### Why use Context7?

**For doc-aide:**
- ✅ Always up-to-date info about UI libraries
- ✅ Correct React/TypeScript patterns
- ✅ Spring Boot / Kotlin best practices
- ✅ Avoid deprecated APIs

---

## Installation

### Automatic configuration (via install.sh)

Run the installation script:
```bash
cd implementations/codex
./install.sh
```

The script offers to add the Context7 MCP automatically.

### Manual configuration

Add to `~/.codex/config.toml`:

```toml
[mcp]

# Context7 MCP Server
[[mcp.servers]]
name = "context7"
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
```

**Restart Codex** to load the MCP server.

---

## Usage

### Basic usage

Add `use context7` to your prompts:

```text
Create a React component with Material UI buttons, use context7
```

### Specify library and version

```text
Refactor to React 19, use context7 for react@19
```

---

## Relevant libraries for doc-aide

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

## Examples

### Material UI

```text
Create a form with TextField and Button from Material UI, use context7 for @mui/material
```

### React Hooks

```text
Optimize with React 19 hooks, use context7 for react@19
```

### Spring Boot

```text
Create a REST endpoint with validation, use context7 for spring-boot
```

---

## Troubleshooting

### Context7 does not respond

1. Check `~/.codex/config.toml`
2. Restart Codex
3. Try again

### Library not found

- Use the official name (e.g. `@navikt/ds-react`)
- Check whether it exists on npm

---

## References

- [Context7 official site](https://context7.com/)
- [Context7 MCP documentation](https://upstash.com/blog/context7-mcp)
- [Codex README](../README.md)
