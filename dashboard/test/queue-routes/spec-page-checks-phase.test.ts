// Spec 302, REQ-2: `specPageView`'s Checks section reads `rows`, `phase`
// and `acceptancePhase` from ONE `parseStatus(checksText)` call, so all
// three answer for the SAME content — branch-aware when the spec has its
// own open `aide/<folder>` branch, disk otherwise (spec 298) — whatever
// tab the request happens to be for.
//
// A regression test for behavior that already works (spec 298's own
// branch-aware read), not a new one: this suite is GREEN before REQ-2's
// refactor lands and stays GREEN after, proving the refactor did not
// silently change which content the tickable rows come from, or break
// the Description tab's own async work now that `target` is built
// earlier in the function.

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { createGitRunner, type GitRunner } from "../../src/git/branch-status.ts";
import { TOKEN, setupQueueRoutesHarness } from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-spec-page-checks-phase-");

afterEach(() => harness.cleanup());

const FOLDER = "81-queue-and-runner";
const PATH = `/specs/aide/${FOLDER}`;
const auth = { headers: { "x-aide-token": TOKEN } };

/** A `4-status.md` with one open Phase 1 row, naming `task` — enough for
 *  `parseStatusChecks` to produce a tickable row and `parseStatus` to
 *  resolve `phase` to "Phase 1: RED". */
const statusWithOpenRow = (task: string): string =>
  "# Status\n\n## Phase 1: RED\n\n| Task | Status | Notes |\n|------|--------|-------|\n" +
  `| ${task} | ⬜ | |\n`;

/** Real git for everything except the branch-read calls
 *  `resolveOpenBranchTarget`/`readStatusFromBranch` make — reproduced
 *  from `committed-history-freshness.test.ts`'s "spec 298" suite, whose
 *  own `branchReadingGitRun` is local to that file's `describe` block
 *  and not exported. */
const branchReadingGitRun = (opts: { open: boolean; branchText?: string }): GitRunner => {
  const real = createGitRunner();
  const branch = `aide/${FOLDER}`;
  const relPath = `aide/specs/${FOLDER}/4-status.md`;
  const ref = `refs/remotes/origin/${branch}`;
  const specFolderSuffix = join("aide", "specs", FOLDER);
  return async (dir, args, timeoutMs, env) => {
    const line = args.join(" ");
    if (line === "rev-parse --show-toplevel" && dir.endsWith(specFolderSuffix)) {
      return { code: 0, stdout: `${dir.slice(0, dir.length - specFolderSuffix.length - 1)}\n` };
    }
    if (line === "ls-remote --heads origin refs/heads/aide/*") {
      return {
        code: 0,
        stdout: opts.open ? `deadbeef0000000000000000000000000000000\trefs/heads/${branch}\n` : "",
      };
    }
    if (line === `fetch --quiet origin ${branch}`) return { code: 0, stdout: "" };
    if (line === `log -1 --format=%H ${ref} -- ${relPath}`) {
      return { code: 0, stdout: "cafebabe000000000000000000000000000000\n" };
    }
    if (line === `show ${ref}:${relPath}`) return { code: 0, stdout: opts.branchText ?? "" };
    return real(dir, args, timeoutMs, env);
  };
};

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
      queueToken: TOKEN,
      gitRun: branchReadingGitRun({ open: true, branchText: statusWithOpenRow("write branch-only test") }),
    });
    // The disk copy is behind: this row sits only on the branch until
    // archive lands it (spec 298).
    writeFileSync(join(specDir(dir), "4-status.md"), statusWithOpenRow("write disk-only test"));
    const html = await (await fetch(`${base}${PATH}?tab=checks`, auth)).text();
    expect(isTickable(html, "write branch-only test")).toBe(true);
    expect(html).not.toContain("write disk-only test");
  });

  test("a spec with no open branch falls back to the disk copy's row, unchanged", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: branchReadingGitRun({ open: false }),
    });
    writeFileSync(join(specDir(dir), "4-status.md"), statusWithOpenRow("write disk-only test"));
    const html = await (await fetch(`${base}${PATH}?tab=checks`, auth)).text();
    expect(isTickable(html, "write disk-only test")).toBe(true);
  });

  // Regression guard for REQ-2's own reordering: `target` is now built
  // BEFORE `formDir`/`descriptionCommit`/`descriptionText`, all of which
  // the Description tab alone computes. A request for that tab must
  // still succeed, and a later request for the Checks tab on the same
  // spec must still resolve the branch content exactly as above —
  // proving the two tabs' own async work does not interfere.
  test("visiting the Description tab first changes nothing about the Checks tab afterwards", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: branchReadingGitRun({ open: true, branchText: statusWithOpenRow("write branch-only test") }),
    });
    writeFileSync(join(specDir(dir), "4-status.md"), statusWithOpenRow("write disk-only test"));
    const description = await fetch(`${base}${PATH}?tab=description`, auth);
    expect(description.status).toBe(200);
    const checks = await (await fetch(`${base}${PATH}?tab=checks`, auth)).text();
    expect(isTickable(checks, "write branch-only test")).toBe(true);
    expect(checks).not.toContain("write disk-only test");
  });
});
