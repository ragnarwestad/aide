// Split out of spec-page.test.ts by theme.

import { describe, expect, test } from "bun:test";
import type { SpecCheckView, SpecPageView } from "../../../../src/render";
import { lead, page, view } from "../spec-page-fixtures.ts";

// --- spec 182, ticked again by spec 212: the spec's remaining checks --------
//
// A check only a person can make — look at the page at 375px and say
// whether it holds — was a row buried near the bottom of the fourth
// file. The rows came to the top of the page instead.
//
// Spec 188 made every row inert and moved the tick onto the Edit form,
// because a second way of changing a spec was one too many to learn.
// Spec 212 gives the boxes back, on the Overview PANEL rather than in
// the banner: the description's own editor is now a tab beside it
// rather than a page behind a link, so a reader still has one place to
// tick — and a form in the banner would ride onto Activity and Steps,
// which reload every ten seconds and would wipe a half-ticked list.
//
// Spec 294: Overview is gone — this is now the Checks tab, so every
// call below names it explicitly rather than riding the page's default.

describe("the checks block (specs 182, 188, 212)", () => {
  const PHASE = "Acceptance criteria";
  const check = (extra: Partial<SpecCheckView> = {}): SpecCheckView => ({
    phase: PHASE,
    line: "| Manual check at 375px in a real browser | ⬜ | still outstanding |",
    task: "Manual check at 375px in a real browser",
    done: false,
    ...extra,
  });

  const DONE = check({ task: "Run the full test suite", line: "| Run the full test suite | ✅ | |", done: true });
  const LATER = check({
    phase: "Phase 5: SHIP",
    task: "Watch the first real run",
    line: "| Watch the first real run | ⬜ | |",
  });

  const withChecks = (rows = [check(), DONE], extra: Partial<SpecPageView> = {}) =>
    view({ checks: { rows, phase: PHASE, baseSha: "b7c40e2deadbeef" }, ...extra });

  /** The checks section alone. The page has real forms on it — Update,
   *  for one — so a claim about "the form" is a claim about this
   *  section and not about the document. */
  const section = (html: string): string => {
    const found = html.match(/<section class="checks">[\s\S]*?<\/section>/);
    expect(found).not.toBeNull();
    return found![0];
  };

  // Running, or a landing in flight — not queued: a queued job writes
  // nothing yet, and an archive job parked on the acceptance hold-back
  // is queued precisely for this tick (371, 2026-09-03).
  for (const lead_ of [lead({ state: "running" }), lead({ state: "done", landing: true })]) {
    test(`a ${lead_.landing ? "landing" : lead_.state} job leaves every check visible but removes the controls`, () => {
      const checks = section(page(withChecks([check(), DONE, LATER], { lead: lead_ }), "status"));
      expect(checks).toContain("Manual check at 375px in a real browser");
      expect(checks).toContain("Run the full test suite");
      expect(checks).not.toContain('name="tick"');
      expect(checks).not.toContain("<form");
      expect(checks).not.toContain("<button");
    });
  }

  test("a queued job — parked, or merely waiting for a slot — leaves the controls in place", () => {
    expect(section(page(withChecks([check()], { lead: lead({ state: "queued" }) }), "status"))).toContain(
      'name="tick"',
    );
  });

  test("a completed job does not make the checks read-only", () => {
    expect(section(page(withChecks([check()], { lead: lead({ state: "done" }) }), "status"))).toContain(
      'name="tick"',
    );
  });
});
