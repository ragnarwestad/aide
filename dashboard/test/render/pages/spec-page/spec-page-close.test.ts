// The Close control and the sentence that says what it means
// sentence, and the closed-spec read-only line. Follows the shape
// spec-page-reopen-and-reset.test.ts's own Reset suite already tests
// against.

import { describe, expect, test } from "bun:test";
import { specActions } from "../../../../src/render";
import { btn } from "../../../../src/render/ui/components";
import { page, view } from "../spec-page-fixtures.ts";

describe("the Close control", () => {
  test("the tab row contains no spec actions (AC-6)", () => {
    const html = page(view({ closeAvailable: true }));
    const group = /<nav class="tabbar subtabs">[\s\S]*?<span class="row">([\s\S]*?)<\/span><\/nav>/.exec(html)?.[1] ?? "";
    expect(group).not.toMatch(/(?:data-ask="(?:reopenask|closeask)"|>Update<|data-pdf)/);
  });

  // "whatever phase it is in, including one where no step has
  // completed" — the render layer draws off `closeAvailable` alone,
  // which the server sets unconditionally for every non-archived spec
  // (spec-views/spec-page.ts), so a `created`-phase spec with no
  // `done` steps at all still gets the control.
  test("present even when no phase has completed yet", () => {
    const html = specActions(view({ closeAvailable: true, done: [] }), "");
    expect(html).toMatch(/<button\b[^>]*\sdata-ask="closeask"[^>]*>Close<\/button>/);
  });

  test("absent for an archived spec", () => {
    expect(specActions(view({ archived: true, closeAvailable: true }), "")).not.toContain("data-ask=\"closeask\"");
  });

  test("absent for a closed spec (closed implies archived)", () => {
    const html = specActions(view({ archived: true, closed: true, closeAvailable: true }), "");
    expect(html).not.toContain("data-ask=\"closeask\"");
  });

  test("disabled with its reason while busy, rather than absent or silently inert", () => {
    const html = specActions(view({ closeAvailable: true, closeUnavailableReason: "a job is running" }), "");
    expect(html).not.toContain("data-ask=\"closeask\"");
    expect(html).toContain(btn({ label: "Close", type: "button", disabled: true }));
    // The reason is not a `title`, nor is it Close's own "(?)": it is
    // one sentence inside the action row's single shared mark, naming
    // Close by name.
    expect(html).not.toMatch(/title="a job is running"/);
    expect(html).toContain("Close can't run right now because a job is running.");
  });

  test("a live spec with no closeAvailable offers nothing of the sort", () => {
    expect(specActions(view(), "")).not.toContain(">Close<");
  });
});

describe("the PDF action", () => {
  test("links to this spec's PDF from the action row (AC-4)", () => {
    expect(specActions(view(), "")).toContain('href="/specs/aide/150-one-page-shows-the-whole-spec/pdf"');
  });

  test("shows the unavailable reason before the disabled PDF action (AC-5)", () => {
    const html = specActions(view({ pdfUnavailableReason: "md-to-pdf is not installed on this host" }), "");
    expect(html).not.toContain('href="/specs/aide/150-one-page-shows-the-whole-spec/pdf"');
    expect(html).toContain("md-to-pdf is not installed on this host");
    expect(html.indexOf("md-to-pdf is not installed on this host")).toBeLessThan(html.indexOf('aria-label="Open this spec as a PDF"'));
  });
});
