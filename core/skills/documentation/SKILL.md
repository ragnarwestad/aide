---
name: documentation
description: >-
  The documentation standard for markdown documents: title, table of
  contents, headings, separators, code blocks, numbered lists, emojis,
  and the practices that make a document useful to an AI assistant.
  Use when: writing or restructuring any markdown document, adding a
  table of contents, formatting code examples, referencing files or
  screenshots in a document.
  Do NOT use for: linter errors specifically (use the markdown-linting
  skill), the 4-file spec layout (use the spec-structure skill).
effort: medium
---

# Documentation standard

## Table of contents

- [General rules for all documents](#general-rules-for-all-documents)
  - [Document structure](#document-structure)
  - [Table of contents](#table-of-contents-1)
  - [Formatting](#formatting)
- [Markdown guidelines](#markdown-guidelines)
  - [Code blocks](#code-blocks)
  - [Emojis](#emojis)
- [Best practices for AI-assisted documentation](#best-practices-for-ai-assisted-documentation)
  - [Visual documentation](#visual-documentation)
  - [Related resources and URLs](#related-resources-and-urls)
  - [Specific instructions](#specific-instructions)
  - [File references](#file-references)
- [See also](#see-also)

---

## General rules for all documents

These rules apply to ALL markdown documents in the project.

### Document structure

All documents must follow this structure:

```markdown
# Document title

## Table of contents

- [Section 1](#section-1)
  - [Subsection 1.1](#subsection-11)
- [Section 2](#section-2)

---

## Section 1

Content...
```

### Table of contents

**Requirements:**
- ALL documents MUST have a table of contents — no length threshold
- Include up to 3 levels (`##`, `###` and `####`) whenever they exist — EVERY real heading in the
  document gets a TOC entry. Headings inside code fences are not headings and stay out
- Place it AT THE VERY TOP, directly after the `# Title` — NEVER any chapter, purpose statement or
  other content before it. An intro/purpose text becomes the FIRST CHAPTER after the TOC, like
  everything else.
- The heading must be `## Table of contents` (no emoji)

**Format:**
```markdown
## Table of contents

- [Main section](#main-section)
  - [Subsection](#subsection)
    - [Sub-subsection](#sub-subsection)
```

### Formatting

**Titles and headings:**
- Document title: `# Title` (only one per document)
- Main sections: `## Section`
- Subsections: `### Subsection`

**Separators:**
- Use `---` between logical sections
- Always `---` after the table of contents

---

## Markdown guidelines

### Code blocks

**Always specify the language at the START:**
- `tsx` for code with JSX (React: `<Component />`)
- `typescript` for TypeScript without JSX
- `bash` for shell commands
- `markdown` for markdown examples
- `text` for general output

**Why:** IDEs parse code blocks and produce warnings if the syntax does not match.

Close a code block with just three backticks; the markdown-linting skill
has why, and the other rules the linter checks (list numbering, anchors).

**Before/After code examples:**

Always split "Before" and "After" into SEPARATE code blocks:

````markdown
**Before:**
```tsx
const [value, setValue] = useState();
```

**After:**
```tsx
const value = useSelector(state => state.value);
```
````

**Why:** Avoids redeclaration errors (same variable name in a single code block).

### Emojis

**Do NOT use emojis in section headings (## headings):**

```markdown
## 📋 Table of contents   (WRONG - emoji in heading)
## Table of contents      (CORRECT)
```

**Why:** Markdown processors strip emojis from heading IDs, which causes MD051 errors (anchor link mismatch).

**Emojis are OK in:**
- Content and body text
- Lists and tables
- Metadata fields

---

## Best practices for AI-assisted documentation

### Visual documentation

**Use screenshots and design mocks when relevant:**
- Include screenshots of UI problems or bugs
- Attach design mocks to show the desired end result
- Create an assets folder: `assets/` in the document folder
- Reference images in markdown: `![Description](./assets/screenshot.png)`

**Why:** Modern AI assistants are multimodal and can iterate visually toward a target image.

**Example:**
```markdown
## Problem

Datepicker shows the wrong format in Safari:

![Safari bug](./assets/safari-datepicker-bug.png)

Desired result:

![Design mock](./assets/datepicker-design.png)
```

### Related resources and URLs

**Include links to external resources:**
- Issue trackers: `https://jira.example.com/browse/PROJ-XXXX`
- Confluence documentation
- Design documents (Figma, Sketch)
- API documentation (Swagger, OpenAPI)

**Why:** URLs give AI assistants access to up-to-date documentation and context.

### Specific instructions

**Be explicit about what should happen:**

**Vague example:**
```markdown
## Problem
Add tests for the application form
```

**Specific example:**
```markdown
## Problem
The application form's validation has no tests. Test these cases:
- Invalid national identity number (11 digits, but wrong check digit)
- Missing required fields (name, address)
- Date of birth in the future

Avoid mocks for validation - use real test data.
```

**Why:** Specific instructions yield a significantly higher success rate.

### File references

**Name concrete files and line numbers where the code is the subject** —
an analysis, a plan, a README: `src/components/CaseOverview.tsx:123-145`.
A spec's description says what the problem is, in the user's terms, and
leaves the files to the analysis.

**Why:** Helps AI assistants locate the right resources without searching,
while the description stays true when the code moves.

---

## See also

- The spec-structure skill - the 4-file spec structure
- The markdown-linting skill - Markdown linting rules
