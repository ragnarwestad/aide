// `specPageView`'s Checks section reads `rows`, `phase`
// and `acceptancePhase` from ONE `parseStatus(checksText)` call, so all
// three answer for the SAME content — branch-aware when the spec has its
// own open `aide/<folder>` branch, disk otherwise — whatever
// tab the request happens to be for.
//
// A regression test for behavior that already works (the
// branch-aware read), not a new one: this suite is GREEN before the
// refactor lands and stays GREEN after, proving the refactor did not
// silently change which content the tickable rows come from, or break
// the Description tab's own async work now that `target` is built
// earlier in the function.

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import type { GitRunner } from "../../../src/git/process/index.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";
import { branchReadingGit } from "../checkouts/branch-reading-fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-spec-page-checks-phase-");

afterEach(() => harness.cleanup());

const FOLDER = "81-queue-and-runner";
const PATH = `/specs/aide/${FOLDER}`;
/** A `4-status.md` with one open Acceptance row, naming `task` — the
 *  Acceptance section because that is the one the Checks tab draws as
 *  boxes, the Phase tables being the implement run's own record. */
const statusWithOpenRow = (task: string): string =>
  "# Status\n\n## Acceptance criteria\n\n| Task | Status | Notes |\n|------|--------|-------|\n" +
  `| ${task} | ⬜ | |\n`;

/** Real git, except for the reads of this spec's open branch. */
const branchReadingGitRun = (opts: { open: boolean; branchText?: string }): GitRunner => branchReadingGit(FOLDER, opts);

const specDir = (dir: string) => join(dir, "root", "aide", "specs", FOLDER);

/** Whether `task` shows up as a TICKABLE row (a checkbox, not the static
 *  ✅/☐ span) — proof the row came off the phase the page resolved as
 *  currently open, not merely that its text is somewhere on the page. */
const isTickable = (html: string, task: string): boolean => {
  const li = html.match(new RegExp(`<li class="check open">.*?${task}.*?</li>`))?.[0] ?? "";
  return li.includes('type="checkbox"');
};

describe("specPageView's Checks tab: rows and phase agree, from one parse", () => {
  test("a spec ticked only on its own open branch draws the branch's tickable row, not the stale disk one", async () => {
    const { base, dir } = start({
      gitRun: branchReadingGitRun({ open: true, branchText: statusWithOpenRow("write branch-only test") }),
    });
    // The disk copy is behind: this row sits only on the branch until
    // archive lands it.
    writeFileSync(join(specDir(dir), "4-status.md"), statusWithOpenRow("write disk-only test"));
    const html = await (await fetch(`${base}${PATH}?tab=status`)).text();
    expect(isTickable(html, "write branch-only test")).toBe(true);
    expect(html).not.toContain("write disk-only test");
  });

  test("a spec with no open branch falls back to the disk copy's row, unchanged", async () => {
    const { base, dir } = start({
      gitRun: branchReadingGitRun({ open: false }),
    });
    writeFileSync(join(specDir(dir), "4-status.md"), statusWithOpenRow("write disk-only test"));
    const html = await (await fetch(`${base}${PATH}?tab=status`)).text();
    expect(isTickable(html, "write disk-only test")).toBe(true);
  });

  // Regression guard for the reordering: `target` is now built
  // BEFORE `formDir`/`descriptionCommit`/`descriptionText`, all of which
  // the Description tab alone computes. A request for that tab must
  // still succeed, and a later request for the Checks tab on the same
  // spec must still resolve the branch content exactly as above —
  // proving the two tabs' own async work does not interfere.
  test("visiting the Description tab first changes nothing about the Checks tab afterwards", async () => {
    const { base, dir } = start({
      gitRun: branchReadingGitRun({ open: true, branchText: statusWithOpenRow("write branch-only test") }),
    });
    writeFileSync(join(specDir(dir), "4-status.md"), statusWithOpenRow("write disk-only test"));
    const description = await fetch(`${base}${PATH}?tab=description`);
    expect(description.status).toBe(200);
    const checks = await (await fetch(`${base}${PATH}?tab=status`)).text();
    expect(isTickable(checks, "write branch-only test")).toBe(true);
    expect(checks).not.toContain("write disk-only test");
  });
});
