// Spec 406: the Close control and the sentence that says what it means
// sentence, and the closed-spec read-only line. Follows the shape
// spec-page-reopen-and-reset.test.ts's own Reset suite already tests
// against.

import { describe, expect, test } from "bun:test";
import { page, view } from "../spec-page-fixtures.ts";

describe("spec 406, REQ-1: the Close control", () => {
  test("present and enabled beside Reset when both actions are offered", () => {
    const html = page(view({ closeAvailable: true }));
    const group = /<nav class="tabbar subtabs">[\s\S]*?<span class="row">([\s\S]*?)<\/span><\/nav>/.exec(html)?.[1] ?? "";
    expect(group).toContain('<button type="button" class="btn" data-ask="closeask">Close</button>');
    expect(group.indexOf("Reset")).toBeLessThan(group.indexOf("Close"));
  });

  // REQ-1: "whatever phase it is in, including one where no step has
  // completed" — the render layer draws off `closeAvailable` alone,
  // which the server sets unconditionally for every non-archived spec
  // (spec-views/spec-page.ts), so a `created`-phase spec with no
  // `done` steps at all still gets the control.
  test("present even when no phase has completed yet", () => {
    const html = page(view({ closeAvailable: true, done: [] }));
    expect(html).toContain('<button type="button" class="btn" data-ask="closeask">Close</button>');
  });

  test("absent for an archived spec", () => {
    expect(page(view({ archived: true, closeAvailable: true }))).not.toContain("data-ask=\"closeask\"");
  });

  test("absent for a closed spec (closed implies archived)", () => {
    const html = page(view({ archived: true, closed: true, closeAvailable: true }));
    expect(html).not.toContain("data-ask=\"closeask\"");
  });

  test("disabled with its reason while busy, rather than absent or silently inert (REQ-11)", () => {
    const html = page(view({ closeAvailable: true, closeUnavailableReason: "a job is running" }));
    expect(html).toContain("Close");
    expect(html).not.toContain("data-ask=\"closeask\"");
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
