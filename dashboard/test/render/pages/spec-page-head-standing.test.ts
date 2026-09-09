// Where the spec stands, on the line that names it. The page said it
// only in the Logs tab, one click away — so a spec whose analyze was
// running looked exactly like one that had never run.

import { describe, expect, test } from "bun:test";
import { page, view } from "./spec-page-fixtures.ts";

const PHASES = [
  { step: "create", attempts: [] },
  { step: "analyze", attempts: [] },
  { step: "implement", attempts: [] },
  { step: "archive", attempts: [] },
];

// The title line, from its own opening to where the banner under it
// starts. Not the first `</div>` — the pips are nested divs of their
// own, and that cut landed inside them.
const head = (html: string) => {
  const i = html.indexOf('<div class="backhead">');
  const end = html.indexOf('<nav class="tabbar subtabs">', i);
  return html.slice(i, end > i ? end : i + 2000);
};

describe("the spec's own line says where it stands", () => {
  // The phase pips used to ride here; the PDF link does now
  // (2026-09-09), at the far right of the line, and the pips are gone.
  test("the PDF link rides at the end of the title line, and no pips do", () => {
    const html = page(view({ phases: PHASES as never, done: ["create", "analyze"], pdfAction: "/specs/aide/x/pdf" }));
    const line = head(html);
    expect(line).toContain('class="headend"');
    expect(line).toContain('href="/specs/aide/x/pdf"');
    expect(line).not.toContain('title="create"');
    expect(line).not.toContain('class="pips');
  });

  test("a running phase says what it is doing, in the reader's language", () => {
    const running = { lead: { runningStep: { step: "analyze", logs: [] } } } as never;
    const en = head(page(view({ phases: PHASES as never, done: [], ...(running as object) })));
    expect(en).toContain("analyzing");
  });

  test("a spec with nothing running names no phase", () => {
    const line = head(page(view({ phases: PHASES as never, done: ["create"] })));
    expect(line).not.toContain("analyzing");
    expect(line).not.toContain("implementing");
  });

  // The slot is the spec page's alone: every other tabbed page draws the
  // title line it always drew.
  test("a page that passes nothing draws no slot at all", () => {
    const html = page(view({ phases: [] as never, done: [] }));
    expect(head(html)).not.toContain('class="headend"');
  });
});
