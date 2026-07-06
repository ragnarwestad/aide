# Documentation standard

## Table of contents

- [General rules for all documents](#general-rules-for-all-documents)
  - [Document structure](#document-structure)
  - [Table of contents](#table-of-contents-1)
  - [Formatting](#formatting)
- [Markdown guidelines](#markdown-guidelines)
  - [Code blocks](#code-blocks)
  - [Numbered lists](#numbered-lists)
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
- All documents over 50 lines MUST have a table of contents
- Use 2 levels (main sections and subsections)
- Place it after the purpose statement and before the first content section
- The heading must be `## Table of contents` (no emoji)

**Format:**
```markdown
## Table of contents

- [Main section](#main-section)
  - [Subsection](#subsection)
```

### Formatting

**Titles and headings:**
- Document title: `# Title` (only one per document)
- Main sections: `## Section`
- Subsections: `### Subsection`
- No emojis in headings (causes problems with anchor links)

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

**CRITICAL: Closing code blocks:**

Code blocks are ALWAYS closed with just three backticks - NEVER with a language specifier:

````markdown
```bash
echo "Hello"
```
````

**WRONG (common AI mistake):**

````markdown
```bash
echo "Hello"
```text
````

**Why this matters:**
- ` ```text` as a closing fence breaks markdown parsing
- Pandoc and other converters interpret it as the start of a new code block
- HTML generation fails with broken code blocks
- Anchor links can end up broken

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

### Numbered lists

**Always start at 1 after a header/section break:**

```markdown
#### Files to change:

1. file1.tsx
2. file2.tsx

#### Files to test:

1. test1.tsx   (CORRECT - starts at 1)
2. test2.tsx
```

**Why:** Markdown linters expect new lists to start at 1.

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

**See also:** [MARKDOWN_LINTING.md](./MARKDOWN_LINTING.md) for detailed linting rules.

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
- JIRA issues: `https://jira.example.com/browse/PROJ-XXXX`
- Confluence documentation
- Design documents (Figma, Sketch)
- API documentation (Swagger, OpenAPI)

**Why:** URLs give AI assistants access to up-to-date documentation and context.

### Specific instructions

**Be explicit and detailed in descriptions:**

**Vague example:**
```markdown
## Problem
Add tests for foo.tsx
```

**Specific example:**
```markdown
## Problem
Write unit tests for `validateApplicationForm()` in foo.tsx:156.
Test the following edge cases:
- Invalid national identity number (11 digits, but wrong check digit)
- Missing required fields (name, address)
- Date of birth in the future

Avoid mocks for validation - use real test data.
```

**Why:** Specific instructions yield a significantly higher success rate.

### File references

**Use concrete file paths:**
- Name exact files: `src/components/CaseOverview.tsx`
- Use line numbers: `CaseOverview.tsx:123-145`

**Why:** Helps AI assistants locate the right resources without searching.

---

## See also

- [REPORT_STRUCTURE.md](./REPORT_STRUCTURE.md) - 4-file structure for JIRA/TODO reports
- [MARKDOWN_LINTING.md](./MARKDOWN_LINTING.md) - Markdown linting rules
