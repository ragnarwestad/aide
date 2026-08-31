// REQ-2: the WYSIWYG editor's markdown engine must round-trip this
// repo's own spec-file conventions with no lossy conversion. Milkdown's
// `@milkdown/core` wraps `unified().use(remarkParse).use(remarkStringify,
// options)` (`packages/core`'s own `remarkStringifyOptionsCtx`), so this
// test drives that exact engine directly — no DOM, no Crepe, no browser
// — and proves both halves of the risk 2-analysis.md found: the DEFAULT
// serializer breaks this repo's `- `/`---` convention (bullets flip to
// `*`, rules to `***`), and `{ bullet: "-", rule: "-" }` fixes it.
//
// REAL_DESCRIPTION is this very spec's own `1-description.md`, verbatim
// (REQ-2: "verify round-trip fidelity against a real spec file's
// content, not just a synthetic snippet") — embedded rather than read
// from the specs repo at test time, so the test does not depend on a
// sibling checkout existing at a particular path.

import { describe, expect, test } from "bun:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";

const REAL_DESCRIPTION = `# Replace the spec-editing textarea with a WYSIWYG markdown editor (Milkdown) - Description

## Table of contents

- [Tracking info](#tracking-info)
- [Description](#description)

---

## Tracking info

- **Model:** claude claude-sonnet-5
- **Time spent:** 0m30s
- **Task:** \`290-replace-the-spec-editing-textarea-with-a-wysiwyg-markdown-editor-milkdown/\`
- **Created:** \`2026-08-31\`

---

## Description

## Problem

The dashboard's spec-editing pages (1-description.md, 2-analysis.md, 3-solution.md, 4-status.md editors) currently use a plain \`<textarea>\`: no line wrapping, no formatting feedback, and no visual distinction between headings, lists, code blocks or the REQ-n/SHALL sections this repo now formalizes in 1-description.md. The user wants full WYSIWYG editing instead of a raw-text or split-pane/preview editor.

Milkdown was chosen after evaluating it against Toast UI Editor and Tiptap:
- Toast UI Editor was ruled out for real, open GitHub issues about mobile behavior (toolbar disappearing, WYSIWYG view jumping to top on focus/scroll).
- Tiptap (with its StarterKit) was ruled out because its markdown round-trip support is an unofficial community package (\`tiptap-markdown\`, last pushed 2025-10-22, 25 open issues) rather than first-party, and because it has two serious, currently OPEN iOS bugs (github.com/ueberdosis/tiptap#7514 "Editor causes global page freeze", #8220 "infinite redraw loop (tab freeze)"), both updated as recently as July/August 2026.
- Milkdown has markdown as its actual source-of-truth model (built on remark/unified, first-party), ships a batteries-included WYSIWYG preset (\`@milkdown/crepe\`), is MIT-licensed, and its mobile-related issues are mostly closed and old (2022-2025). It has one narrow open round-trip bug (backslashes in autolink URLs double on every round-trip, milkdown/milkdown#2349) which is small enough to accept or work around.

## Requirements

- **REQ-1:** The spec-editing pages SHALL offer full WYSIWYG editing (inline rendering of headings, lists, code blocks, emphasis, etc. as the person types) rather than a raw-text \`<textarea>\` or a split source/preview view.
- **REQ-2:** The editor SHALL round-trip to and from plain markdown with no lossy conversion of the structures actually used in this repo's spec files: headings, ordered/unordered lists (including nested lists), code blocks/fences, emphasis, links, and the \`## Requirements\` section's REQ-n/SHALL bullet format (spec-structure rule). Analysis SHALL verify round-trip fidelity against a real spec file's content, not just a synthetic snippet.
- **REQ-3:** The editor SHALL behave reasonably on mobile/touch — analysis SHALL define "reasonably" concretely (e.g., the toolbar/UI must not disappear or jump/scroll unexpectedly on focus), but editing does not need to be equally comfortable as desktop; this is explicitly a lower bar than full mobile editing ergonomics.
- **REQ-4:** The library used SHALL be MIT-licensed (or an equivalently permissive free license) with no paid tier gating any feature this integration depends on.
- **REQ-5:** Analysis SHALL decide and document which Milkdown package(s) to depend on (e.g. \`@milkdown/crepe\` vs. assembling \`@milkdown/core\` plus individual plugins) and confirm a vanilla-TypeScript integration path exists (this dashboard is not React/Vue).
- **REQ-6:** The new editor SHALL replace the textarea on every spec-editing page that currently has one — analysis SHALL enumerate the exact set of pages/routes this covers.

## Ikke i scope for denne runden

- Collaborative/real-time editing, comments, or any Tiptap-Pro-equivalent feature — nobody asked for this.
- Perfect mobile editing ergonomics (drag-handles, mobile-specific toolbars) — REQ-3's bar is "does not break the UI," not full mobile parity with desktop.
- Migrating any content already stored — this only changes the editing widget, not stored file format (which stays plain markdown either way).

Ingen JIRA-sak.

*This description can be edited before /aide-analyze runs.*
`;

// A synthetic addition covering the two REQ-2-named structures the real
// file above happens not to use: a nested list, and a code fence.
const NESTED_LISTS_AND_CODE_FENCES = `## Nested lists and code fences

- Top level item one
  - Nested item A
  - Nested item B
- Top level item two

\`\`\`ts
export function f(): number {
  return 1;
}
\`\`\`

1. Ordered one
2. Ordered two
   - Nested bullet under ordered
`;

function roundtrip(text: string, options?: { bullet: "-"; rule: "-" }): string {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkStringify, options);
  return String(processor.processSync(text));
}

describe("the WYSIWYG editor's markdown engine, configured for this repo's convention (REQ-2)", () => {
  test("UNCONFIGURED: the default serializer flips this repo's own markers (proves the risk is real)", () => {
    const out = roundtrip(REAL_DESCRIPTION);
    // Every `- ` bullet becomes `* `.
    expect(/^\* /m.test(out)).toBe(true);
    // Every `---` rule becomes `***`.
    expect(/^\*\*\*$/m.test(out)).toBe(true);
    // Which breaks withDependsOnLine()'s anchor outright.
    expect(out).not.toContain("- **Created:**");
  });

  test("CONFIGURED ({ bullet: '-', rule: '-' }): no marker flips anywhere", () => {
    const out = roundtrip(REAL_DESCRIPTION, { bullet: "-", rule: "-" });
    expect(/^\* /m.test(out)).toBe(false);
    expect(/^\*\*\*$/m.test(out)).toBe(false);
  });

  test("CONFIGURED: withDependsOnLine()'s anchor line survives byte-for-byte", () => {
    const out = roundtrip(REAL_DESCRIPTION, { bullet: "-", rule: "-" });
    expect(out).toContain("- **Created:** `2026-08-31`");
  });

  test("CONFIGURED: markdownSection()'s `---` boundaries still split the file the same way", () => {
    const out = roundtrip(REAL_DESCRIPTION, { bullet: "-", rule: "-" });
    expect(out.split(/^---\s*$/m).length).toBe(REAL_DESCRIPTION.split(/^---\s*$/m).length);
  });

  test("CONFIGURED: the only remaining diff is one blank line inserted before a list that had none in the source", () => {
    const out = roundtrip(REAL_DESCRIPTION, { bullet: "-", rule: "-" });
    // The one tight paragraph-then-list attachment REAL_DESCRIPTION uses:
    // no blank line between the sentence and its list in the source.
    const normalizedSource = REAL_DESCRIPTION.replace(
      "Milkdown was chosen after evaluating it against Toast UI Editor and Tiptap:\n-",
      "Milkdown was chosen after evaluating it against Toast UI Editor and Tiptap:\n\n-",
    );
    expect(out).toBe(normalizedSource);
  });

  test("CONFIGURED: nested lists and code fences round-trip byte-for-byte (no tight-attachment gap here)", () => {
    const out = roundtrip(NESTED_LISTS_AND_CODE_FENCES, { bullet: "-", rule: "-" });
    expect(out).toBe(NESTED_LISTS_AND_CODE_FENCES);
  });

  test("CONFIGURED: REQ-n/SHALL bullets keep their bold label markers and their exact wording", () => {
    const out = roundtrip(REAL_DESCRIPTION, { bullet: "-", rule: "-" });
    for (let n = 1; n <= 6; n++) {
      expect(out).toContain(`- **REQ-${n}:**`);
    }
    expect(out).toContain("SHALL offer full WYSIWYG editing");
  });
});
