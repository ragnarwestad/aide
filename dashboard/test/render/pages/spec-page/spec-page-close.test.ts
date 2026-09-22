// Spec 406: the Close control and the sentence that says what it means
// sentence, and the closed-spec read-only line. Follows the shape
// spec-page-reopen-and-reset.test.ts's own Reset suite already tests
// against.

import { describe, expect, test } from "bun:test";
import type { SpecPageView } from "../../../../src/render";
import { page, view } from "../spec-page-fixtures.ts";

describe("spec 406, REQ-1: the Close control", () => {
  test("present and enabled beside Reset when both actions are offered", () => {
    const html = page(view({ closeAvailable: true }));
    const group = /<nav class="tabbar subtabs">[\s\S]*?<span class="row">([\s\S]*?)<\/span><\/nav>/.exec(html)?.[1] ?? "";
    expect(group).toContain('<button type="button" class="btn" data-close-ask>Close</button>');
    expect(group.indexOf("Reset")).toBeLessThan(group.indexOf("Close"));
  });

  // REQ-1: "whatever phase it is in, including one where no step has
  // completed" — the render layer draws off `closeAvailable` alone,
  // which the server sets unconditionally for every non-archived spec
  // (spec-views/spec-page.ts), so a `created`-phase spec with no
  // `done` steps at all still gets the control.
  test("present even when no phase has completed yet", () => {
    const html = page(view({ closeAvailable: true, done: [] }));
    expect(html).toContain('<button type="button" class="btn" data-close-ask>Close</button>');
  });

  test("absent for an archived spec", () => {
    expect(page(view({ archived: true, closeAvailable: true }))).not.toContain("data-close-ask");
  });

  test("absent for a closed spec (closed implies archived)", () => {
    const html = page(view({ archived: true, closed: true, closeAvailable: true }));
    expect(html).not.toContain("data-close-ask");
  });

  test("disabled with its reason while busy, rather than absent or silently inert (REQ-11)", () => {
    const html = page(view({ closeAvailable: true, closeUnavailableReason: "a job is running" }));
    expect(html).toContain("Close");
    expect(html).not.toContain("data-close-ask");
    expect(html).toContain('aria-disabled="true"');
    // Spec 454: the reason is not a `title`. Spec 457: nor is it Close's
    // own "(?)" any more — it is one sentence inside the action row's
    // single shared mark, naming Close by name.
    expect(html).not.toMatch(/title="a job is running"/);
    expect(html).toContain("Close can't run right now because a job is running.");
  });

  test("a live spec with no closeAvailable offers nothing of the sort", () => {
    expect(page(view())).not.toContain(">Close<");
  });
});

describe("spec 406, REQ-2: what Close means is visible page text, not only a hover title", () => {
  test("present whenever either control is drawn", () => {
    const html = page(view({ closeAvailable: true }));
    const withoutTitles = html.replace(/title="[^"]*"/g, "");
    expect(withoutTitles).toContain("Close says this spec will not work and archives it as a record");
  });

  test("absent once the spec is archived — nothing left to distinguish", () => {
    const html = page(view({ archived: true, closeAvailable: true }));
    expect(html).not.toContain("Close says this spec will not work and archives it as a record");
  });
});

describe("spec 406, REQ-7: a closed spec reads as closed, never as archived", () => {
  const closedView = (extra: Partial<SpecPageView> = {}) =>
    view({ archived: true, closed: true, closedDate: "2026-09-05", closeReason: "this idea does not hold", ...extra });

  test("the read-only line names the reason and the date, and never says archived", () => {
    const html = page(closedView());
    expect(html).toContain("This spec was closed");
    expect(html).toContain("2026-09-05");
    expect(html).toContain("this idea does not hold");
    expect(html).not.toContain("This spec has been archived");
    // Scoped to the banner's own read-only line, not the whole page:
    // the shell's unrelated chrome (CSS class names, the About dialog,
    // a document tab's own generic help text) legitimately says
    // "archived" elsewhere and is not what REQ-7 is about.
    const desc = /<p class="desc">[\s\S]*?<\/p>/.exec(html)?.[0] ?? "";
    expect(desc).not.toMatch(/\barchived\b/i);
  });

  test("a plainly archived spec (not closed) still reads the old way", () => {
    const html = page(view({ archived: true, closed: false }));
    expect(html).toContain("This spec has been archived");
    expect(html).not.toContain("This spec was closed");
  });

  // REQ-10: nothing on a closed spec's page is editable — it shares the
  // exact `view.archived` gate every other read-only surface already
  // uses (documentPanel, checklist), so this is a regression guard
  // rather than new logic.
  test("no editable form is drawn — description, checks or tracking", () => {
    const html = page(closedView());
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('class="checkbox"><input type="checkbox" name="tick"');
    expect(html).not.toContain('method="post" action="/api/queue/specs/aide/150-one-page-shows-the-whole-spec/save"');
  });
});
