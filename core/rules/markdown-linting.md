# Markdown Linting

## Table of contents

- [Overview](#overview)
- [Usage](#usage)
- [Configuration](#configuration)
- [Responsibilities](#responsibilities)
- [Common errors and solutions](#common-errors-and-solutions)
  - [MD029: List numbering](#md029-list-numbering)
  - [MD040: Missing code block language](#md040-missing-code-block-language)
  - [MD051: Broken anchor link](#md051-broken-anchor-link)
  - [Common AI mistake: Closing a code block with a language](#common-ai-mistake-closing-a-code-block-with-a-language)

---

## Overview

This workspace uses `markdownlint-cli2` via `npx` to catch markdown errors before they are committed.

**Focus areas:**
1. **List numbering (MD029)** - Numbered lists must restart at 1 after headers
2. **Anchor links (MD051)** - TOC links must match actual heading anchors
3. **Code block language (MD040)** - All code blocks must specify language (tsx, typescript, bash, etc.)

## Usage

### Check all markdown files

```bash
npx markdownlint-cli2 '**/*.md'
```

### Automatically fix what can be fixed

```bash
npx markdownlint-cli2 --fix '**/*.md'
```

## Configuration

See `.markdownlint-cli2.jsonc` for the rules.

**Important:** The configuration is minimal and focuses ONLY on the critical issues we have had problems with.

## Responsibilities

**ALL AI implementations (Claude Code, Cursor, Junie, Codex, etc.):**
- Must ALWAYS run linting on markdown files after writing/editing/moving them
- Must fix all MD029, MD040 and MD051 errors before the task is done
- Command: `npx markdownlint-cli2 <file.md>` or `npx markdownlint-cli2 '**/*.md'`

**Manual check (optional):** You can run linting to double-check.

## Common errors and solutions

### MD029: List numbering

**Wrong:**
```markdown
### My Header

3. First item
4. Second item
```

**Solution:**
```markdown
### My Header

1. First item
2. Second item
```

### MD040: Missing code block language

**Wrong:**
```markdown
\```
const foo = 'bar';
\```
```

**Solution:**
```markdown
\```typescript
const foo = 'bar';
\```
```

**Important:** Use `tsx` for React/JSX code, not `typescript`.

### MD051: Broken anchor link

**Wrong:**
```markdown
- [My Section](#my-section)

## 1. My Section
```

**Solution:**
```markdown
- [My Section](#1-my-section)

## 1. My Section
```

Or update the HTML anchor:
```markdown
<a id="my-section"></a>
## 1. My Section
```
to:
```markdown
<a id="1-my-section"></a>
## 1. My Section
```

### Common AI mistake: Closing a code block with a language

**Wrong (not caught by the linter, but breaks HTML generation):**

````markdown
```bash
echo "Hello"
```text
````

**Solution:**

````markdown
```bash
echo "Hello"
```
````

**Why this happens:**
- AI assistants (Claude, Copilot, etc.) sometimes write ` ```text` as a closing fence
- This is NOT valid markdown - code blocks are ALWAYS closed with just ` ``` `
- Pandoc and other converters interpret ` ```text` as the START of a new code block
- The result is broken HTML with wrong code blocks and broken anchor links

**Preventive fix:**
- The `aide-generate-html` script corrects this automatically
- But the source should be fixed - see [documentation.md](./documentation.md#code-blocks)
