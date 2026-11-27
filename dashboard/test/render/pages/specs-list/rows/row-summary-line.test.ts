import { describe, expect, test } from "bun:test";
import { renderSpecsRows } from "../../../../../src/render";
import { openKeys, row, specTarget, openRowsAt } from "../../fixtures.ts";

// Split out of listing-and-units.test.ts by theme.
describe("one line per row for what is going on and what is next", () => {
  const target = specTarget;
  // Open: several of these read the button that names the next phase,
  // and since 2026-09-08 that button rides the caption line the fold
  // opens. The head line this describe is about is drawn the same way
  // either way.
  const rows = openRowsAt("2026-08-18T12:00:00Z");
  const stateCell = (html: string) => {
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>\s*<tr class="specstate"[\s\S]*?<\/tr>/)?.[0] ?? "";
    // By its COLUMN, not its position: the header is two rows now and
    // the chevron has a cell of its own, so counting cells says nothing.
    return head.match(/<td[^>]*data-col="state"[\s\S]*?<\/td>/)?.[0] ?? "";
  };
  /** The FIRST line — the badge itself. Once nothing is
   *  running it carries the whole sentence. */
  const chip = (html: string) => {
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>\s*<tr class="specstate"[\s\S]*?<\/tr>/)?.[0] ?? "";
    const state = head.match(/<td[^>]*data-col="state"[\s\S]*?<\/td>/)?.[0] ?? "";
    return state.match(/<span class="badge b-[a-z]+"[^>]*>([^<]*)<\/span>/)?.[1] ?? "";
  };

  test("a spec with only archive left says so", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["implement"], state: "done" })],
      [target("101-a", { done: ["analyze", "implement"] })],
    );
    expect(chip(html)).toBe("Implemented");
    expect(html).toContain(">Archive</button>");
  });

  test("the state mark and title link follow the spec, without a Jobs button (AC-9, AC-10, AC-11, AC-12, AC-13)", () => {
    const withJobsList = [row({ specFolder: "101-a", steps: ["analyze"], state: "done" })];
    const withJobsTargets = [target("101-a", { done: ["analyze"], notVerified: 2 })];
    const withJobs = renderSpecsRows(
      withJobsList,
      { runnerAvailable: true, targets: withJobsTargets, openSpec: {}, filter: { open: openKeys(withJobsList, withJobsTargets) } },
      Date.parse("2026-08-18T12:00:00Z"),
    );
    expect(withJobs).toContain(">Idle<");
    expect(withJobs).toContain('/?q=aide%3A101');
    expect(withJobs).not.toContain(">Jobs</a>");

    const withoutJobsTargets = [target("102-b", { done: ["analyze"] })];
    const withoutJobs = renderSpecsRows(
      [],
      { runnerAvailable: true, targets: withoutJobsTargets, openSpec: {}, filter: { open: openKeys([], withoutJobsTargets) } },
      Date.parse("2026-08-18T12:00:00Z"),
    );
    expect(withoutJobs).not.toContain('/?q=aide%3A102');
  });

  // Archive is the one phase whose "done" the job's own exit
  // status cannot answer, so the sentence reads the file instead.
  test("a finished archive job keeps its held-back reason in the notice", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["archive"], state: "done" })],
      [target("101-a", { archiveHeldBack: { reason: "the Slack webhook" } })],
    );
    // The badge keeps the WORD — it is `nowrap`, and the
    // reason is a sentence — and the row's panel says the reason.
    expect(chip(html)).toBe("Held back");
    expect(chip(html)).not.toContain("nothing waiting on you");
    // Once, not twice: the badge says it, so the line below has nothing
    // left to add.
    expect(html.match(/the Slack webhook/g)).toHaveLength(1);
    expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
      "Archive held back: the Slack webhook",
    );
  });

  // For the four states that stopped short the file's reason is said in
  // the row's panel, not on the line below the badge — the same sentence,
  // in the one place on the row that has the width for it. The line
  // below says what to press.
  test("a run that stopped short says the held-back reason in the row's panel", () => {
    for (const state of ["failed", "waiting", "cancelled"] as const) {
      const html = rows(
        [row({ specFolder: "101-a", steps: ["archive"], state })],
        [target("101-a", { archiveHeldBack: { reason: "the Slack webhook" } })],
      );
      expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
        "Archive held back: the Slack webhook",
      );
      // And nothing under the badge at all any more.
      expect(stateCell(html)).not.toContain('<div class="muted small">');
      expect(html.match(/the Slack webhook/g)).toHaveLength(1);
    }
  });
});
