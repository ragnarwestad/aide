---
name: documentation
description: >-
  The documentation standard for markdown documents: what a page is for
  and who reads it, then title, table of contents, headings, separators,
  code blocks, numbered lists, emojis, and the practices that make a
  document useful to an AI assistant.
  Use when: writing, trimming or restructuring any markdown document,
  deciding what belongs on a page or in a README, adding a
  table of contents, formatting code examples, referencing files or
  screenshots in a document.
  Do NOT use for: linter errors specifically (use the markdown-linting
  skill), the 4-file spec layout (use the spec-structure skill).
effort: medium
---

# Documentation standard

## Table of contents

- [What a page is for](#what-a-page-is-for)
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

## What a page is for

A page has one reader and one kind, after [Diátaxis](https://diataxis.fr). Decide both before
writing, and say the reader in the page's first lines.

| Kind        | The reader wants to …                 | It holds                                      |
| ----------- | ------------------------------------- | --------------------------------------------- |
| Tutorial    | learn by doing it once, start to end  | one path that works, no options or detours    |
| How-to      | get one task done                     | the steps for that task, and nothing else     |
| Reference   | look a fact up                        | every key, route, state or command, terse     |
| Explanation | understand why it is the way it is    | the reasoning and the trade-offs, no steps    |

- **A page that mixes kinds is split, or loses the part that belongs elsewhere.** A how-to that
  explains, or a reference that teaches, is what makes a page long without making it useful.
- **A fact stands in one place.** Every other page links to it instead of restating it, so a
  change is made once and no copy is left saying the old thing.
- **A README is the front door:** what the project is and why, how to install it, the first run,
  and links onward. It does not list what the pages behind it already describe.
- **A user's page says what to do and what happens, not how the code does it.** Implementation
  detail belongs on the pages for whoever changes the code.
- **Every sentence earns its place:** keep it only when it changes what the reader does or
  understands. A sentence that restates the heading, or narrates what the tool does on its own,
  goes.
- **Every claim is checked against the code before it is written.** Who does a thing (the user,
  the board, the AI tool), what a step does, a file or folder name, a count, a flag, a default:
  read it in the source in the same change, not from memory or from another page. A claim that
  cannot be checked is not written. Trimming or rewording a page re-checks every claim it keeps.
- **Plain statements, no pitch.** Say what happens, in the words the program uses. A sentence
  that sells ("so the reasoning a chat history loses is still there") is cut or replaced by the
  fact under it.

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
- Every document has a table of contents, whatever its length
- Include up to 3 levels (`##`, `###` and `####`) whenever they exist — every real heading in the
  document gets a TOC entry. Headings inside code fences are not headings and stay out
- Place it at the top, directly after the `# Title`, with no chapter, purpose statement or other
  content before it. An intro/purpose text becomes the first chapter after the TOC, like
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
