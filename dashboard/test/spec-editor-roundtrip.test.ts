// REQ-2/REQ-7: Toast UI Editor's markdown engine (`toastmark`) has no
// published standalone markdown-to-markdown serializer (2-analysis.md,
// Codebase analysis) — the only way to reach `getMarkdown()`'s real
// output is a live `Editor` instance, which needs a DOM. `happy-dom` is
// registered globally for this file only (`beforeAll`/`afterAll`),
// never leaking into the rest of the suite.
//
// Only the CONFIGURED path is exercised here, deliberately: the
// convertor map `customMarkdownRenderer` patches is a module-level
// singleton inside the compiled bundle, not per-`Editor` state
// (2-analysis.md). An `Editor` built WITHOUT the override, run in the
// same process after one built WITH it, would silently inherit the
// override rather than the library's true default — false confidence
// either way. The UNCONFIGURED proof (default serializer flips `- ` to
// `* ` and `---` to `***`) already ran once during analysis and is
// cited in 3-solution.md's Recommended solution rather than re-run
// here.
//
// REAL_DESCRIPTION is this very spec's own `1-description.md`, verbatim
// (REQ-2: "verify round-trip fidelity against a real spec file's
// content, not just a synthetic snippet") — embedded rather than read
// from the specs repo at test time, so the test does not depend on a
// sibling checkout existing at a particular path.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { asFileText } from "../src/git/specs-pull.ts";

const REAL_DESCRIPTION = `# Replace the spec-editing textarea with Toast UI Editor - Description

## Table of contents

- [Tracking info](#tracking-info)
- [Description](#description)

---

## Tracking info

- **Model:** claude claude-sonnet-5
- **Time spent:** 1m32s
- **Task:** \`292-replace-the-spec-editing-textarea-with-toast-ui-editor/\`
- **Created:** \`2026-08-31\`

---

## Description

## Problem

The dashboard's spec-editing pages (currently just the Description tab's textarea) offer no formatting feedback, no line wrapping, and no visual distinction between headings, lists, code blocks or the REQ-n/SHALL sections this repo formalizes in 1-description.md. The user wants a classic WYSIWYG editor: an editable surface with a toolbar on top (not raw markdown, and not a Notion-style block editor).

A prior attempt (spec 290, archived) integrated Milkdown (a Notion-style block editor, via \`@milkdown/crepe\`) into this same Description tab. It was reverted the same day it shipped: its LinkTooltip component rendered already open on every page load with no interaction at all, and even after disabling that feature, the underlying interaction model (inline block-by-block editing, floating per-block controls, a "+"-menu for inserting new block types) did not match what the user actually wanted — a single editable document with a persistent top toolbar, the way a normal document editor works. The revert commits are \`b262ce7\` and \`c2f7378\` on the aide repo's main branch; the archived spec is \`290-replace-the-spec-editing-textarea-with-a-wysiwyg-markdown-editor-milkdown\`.

The user then tried live demos of several classic (non-block) WYSIWYG editors and chose **Toast UI Editor** (https://nhn.github.io/tui.editor/latest/tutorial-example01-editor-basic) after trying it directly. Unlike Milkdown, Toast UI Editor is markdown-native (its own source-of-truth format is markdown, not HTML converted through a data processor), MIT-licensed, and its interaction model is the classic one: a persistent toolbar above a single editable surface, with a WYSIWYG/Markdown mode toggle — not per-block floating controls.

Known risk carried over from the original evaluation (before Milkdown was chosen instead): Toast UI Editor has real, open GitHub issues about mobile behavior — the toolbar disappearing and the WYSIWYG view jumping to the top of the page on focus/scroll. Given the Milkdown experience, this spec treats "does the toolbar/editing surface behave reasonably on mobile" as something analysis and manual verification must actually check against a real device, not assume from documentation.

## Requirements

- **REQ-1:** The Description tab SHALL offer WYSIWYG editing through a single, persistent top toolbar over one continuously editable document surface — not a block-by-block/Notion-style editing model, and not a raw-text \`<textarea>\` alone.
- **REQ-2:** The editor SHALL round-trip to and from plain markdown with no lossy conversion of the structures actually used in this repo's spec files: headings, ordered/unordered lists (including nested lists), code blocks/fences, emphasis, links, and the \`## Requirements\` section's REQ-n/SHALL bullet format (spec-structure rule). Analysis SHALL verify round-trip fidelity against a real spec file's content (e.g. this repo's own 1-description.md), not just a synthetic snippet — reusing the same verification approach spec 290's own roundtrip test used, adapted to Toast UI Editor's serializer.
- **REQ-3:** Analysis SHALL research Toast UI Editor's current open GitHub issues specifically about mobile/touch behavior (toolbar disappearing, WYSIWYG view jumping on focus/scroll) and report their current state (open/closed, how recent) before implementation begins. Implementation SHALL then manually verify on an actual mobile-width viewport that the toolbar and editing surface do not disappear or jump unexpectedly — REQ-3's bar is "does not break the UI," not full mobile editing parity with desktop.
- **REQ-4:** The library and any of its dependencies actually used SHALL be MIT-licensed (or an equivalently permissive free license) with no paid tier gating any feature this integration depends on. Analysis SHALL grep the license field of every installed package, the same way spec 290's manual verification did.
- **REQ-5:** Analysis SHALL decide and document which Toast UI Editor package(s) and build (e.g. \`@toast-ui/editor\`, ESM vs UMD) to depend on, and confirm a vanilla-TypeScript integration path exists (this dashboard is not React/Vue) — including how the bundle's own CSS is delivered, following the same constraint spec 290's analysis worked through (this dashboard's \`Bun.build\` step serves exactly one script per page, with no second static asset route for a separate stylesheet).
- **REQ-6:** The new editor SHALL replace the textarea on every spec-editing page that currently has one — analysis SHALL enumerate the exact set of pages/routes this covers (as of this writing, the Description tab is the only one).
- **REQ-7:** Manual verification SHALL include a real save-through-the-editor round trip on a throwaway spec (not just the automated roundtrip test), confirming the saved file's \`git diff\` shows only the intended change — the same check spec 290's own solution document planned but that this round didn't reach before the revert.

## Ikke i scope for denne runden

- Collaborative/real-time editing, comments, or any paid-tier-equivalent feature — nobody asked for this.
- Perfect mobile editing ergonomics — REQ-3's bar is "does not break the UI," not full mobile parity with desktop.
- Migrating any content already stored — this only changes the editing widget, not the stored file format (which stays plain markdown either way).
- Re-litigating the Milkdown-vs-Toast-UI-Editor decision itself — that comparison is done; this spec is about integrating Toast UI Editor specifically, given the user directly tried its demo and chose it.

Ingen JIRA-sak.

*This description can be edited before /aide-analyze runs.*
`;

// A synthetic addition covering the REQ-2-named structures the real
// file above happens not to use: a nested list, an ordered list, a code
// fence, emphasis and a link.
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

An *emphasized* word, a **bold** one, and a [link](https://example.com).
`;

function bulletThematicOverride() {
  return {
    bulletList(_nodeInfo: unknown, { origin }: { origin?: () => { delim?: string | string[] } }) {
      return { ...origin!(), delim: "-" };
    },
    thematicBreak(_nodeInfo: unknown, { origin }: { origin?: () => { delim?: string | string[] } }) {
      return { ...origin!(), delim: "---" };
    },
  };
}

// The bare specifier resolves to the package's top-level `.d.ts` file
// instead of its real entry (same Bun resolution bug `static.ts`'s
// `toastUiEditorResolveFix` plugin works around for the production
// bundle) — `bun test` never runs that bundler, so the workaround here
// is the same fix applied directly: resolve the one subpath that IS
// correctly exported (`package.json` itself) to find the real file.
const toastUiEditorEntry = join(
  dirname(Bun.resolveSync("@toast-ui/editor/package.json", import.meta.dir)),
  "dist/esm/index.js",
);

async function roundtrip(text: string): Promise<string> {
  const Editor = (await import(toastUiEditorEntry)).default;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    el: host,
    height: "auto",
    initialEditType: "wysiwyg",
    previewStyle: "tab",
    usageStatistics: false,
    initialValue: text,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customMarkdownRenderer: bulletThematicOverride() as any,
  });
  return editor.getMarkdown();
}

describe("the editor's markdown engine, configured for this repo's convention (REQ-2)", () => {
  beforeAll(async () => {
    const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
    GlobalRegistrator.register();
  });

  afterAll(async () => {
    const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
    await GlobalRegistrator.unregister();
  });

  test("CONFIGURED: byte-for-byte against this repo's own 1-description.md", async () => {
    const out = await roundtrip(REAL_DESCRIPTION);
    expect(asFileText(out)).toBe(REAL_DESCRIPTION);
  });

  test("CONFIGURED: withDependsOnLine()'s anchor line survives byte-for-byte", async () => {
    const out = await roundtrip(REAL_DESCRIPTION);
    expect(out).toContain("- **Created:** `2026-08-31`");
  });

  test("CONFIGURED: every REQ-n/SHALL bullet keeps its bold label marker and exact wording", async () => {
    const out = await roundtrip(REAL_DESCRIPTION);
    for (let n = 1; n <= 7; n++) {
      expect(out).toContain(`- **REQ-${n}:**`);
    }
    expect(out).toContain("SHALL offer WYSIWYG editing");
  });

  test("CONFIGURED: no bullet or rule marker is flipped anywhere in the file", async () => {
    const out = await roundtrip(REAL_DESCRIPTION);
    expect(/^\* /m.test(out)).toBe(false);
    expect(/^\*\*\*$/m.test(out)).toBe(false);
  });

  test("CONFIGURED: ATX headings stay ATX, not setext", async () => {
    const out = await roundtrip(REAL_DESCRIPTION);
    expect(out).toContain("## Table of contents");
    expect(/^={3,}$/m.test(out)).toBe(false);
  });

  test("CONFIGURED: code fences, emphasis and links survive with content and semantics intact", async () => {
    const out = await roundtrip(NESTED_LISTS_AND_CODE_FENCES);
    expect(out).toContain("```ts");
    expect(out).toContain("export function f(): number {");
    expect(out).toContain("*emphasized*");
    expect(out).toContain("**bold**");
    expect(out).toContain("[link](https://example.com)");
  });

  test("CONFIGURED: nested list indentation may widen, but nesting depth, order and marker do not change (accepted quirk, criterion 4)", async () => {
    const out = await roundtrip(NESTED_LISTS_AND_CODE_FENCES);
    expect(out).toContain("- Top level item one");
    expect(out).toContain("- Nested item A");
    expect(out).toContain("- Nested item B");
    expect(out).toContain("- Top level item two");
    expect(out).toContain("1. Ordered one");
    expect(out).toContain("2. Ordered two");
    expect(out).toContain("- Nested bullet under ordered");
  });
});
