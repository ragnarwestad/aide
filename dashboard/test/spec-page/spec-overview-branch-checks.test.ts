// Spec 291: the Overview page's Checks section reads from an active
// spec's own OPEN `aide/<folder>` branch when one exists, instead of
// from `main`'s copy in the shared machinery checkout — because
// `implement` never merges its own work, only `archive` does, and
// `archive`'s own human-approval gate (every Acceptance-criteria row
// ticked) needs to see the real, already-committed progress that gate
// is itself checking.
//
// Split out from spec-overview-checks.test.ts, whose own suite is about
// the disk-only (no open branch) case this feature must leave
// unchanged (REQ-2).

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  PHASE, EARLIER_PHASE, OPEN_ROW, DONE_ROW, EARLIER_DONE_ROW, phaseSection,
  statusPath, tick, BRANCH_FILE_SHA, branchAwareGitRunner,
} from "./spec-checks-fixtures.ts";
import { CHECKS_TAB, TOKEN, auth, createSpecSaveHarness } from "./spec-save-fixtures.ts";

const { harness } = createSpecSaveHarness();
afterEach(() => harness.cleanup());

// The disk's own `4-status.md` — what `main` says — deliberately
// UNLIKE the branch content below, so a test that sees the branch's
// numbers instead of these proves REQ-1 rather than merely proving the
// route still answers with something.
const MAIN_ONLY_STATUS = ["# Queue - Status", "", phaseSection(PHASE, [DONE_ROW])].join("\n");

// `CHECKS_TAB`, not the bare page: spec 291 named this helper when the
// Checks section lived on the page's default tab, still called
// "Overview" at the time. Spec 294, landed the same day, renamed that
// tab to "Checks" and moved the default tab to Description — so the
// bare URL now serves a different tab entirely.
const overview = (base: string) => fetch(`${base}${CHECKS_TAB}`, auth).then((r) => r.text());

describe("the Checks section reads an open branch's own progress (REQ-1/REQ-2)", () => {
  test("an open branch's 4-status.md wins over main's, both rows and the open count", async () => {
    const { run } = branchAwareGitRunner({ open: true, branchText: MAIN_STATUS_WITH_OPEN_ROWS() });
    const { base } = harness.start({ description: "# d\n", status: MAIN_ONLY_STATUS, extra: { queueToken: TOKEN, gitRun: run } });
    const html = await overview(base);
    // The branch's own open rows, not main's "all done" copy.
    expect(html).toContain("Manual check at 375px in a real browser");
    expect(html).toContain('name="tick"');
    expect(html).toContain("1 of 2 still open");
  });

  test("with no open branch, the Checks section reads main exactly as before (REQ-2)", async () => {
    const { run } = branchAwareGitRunner({ open: false, branchText: MAIN_STATUS_WITH_OPEN_ROWS() });
    const { base } = harness.start({ description: "# d\n", status: MAIN_ONLY_STATUS, extra: { queueToken: TOKEN, gitRun: run } });
    const html = await overview(base);
    // main's own content — done, no boxes — and never the branch's.
    expect(html).not.toContain('name="tick"');
    expect(html).toContain("Run the full test suite");
  });

  test("the tick form's baseSha is the branch's own file commit, not main's", async () => {
    const { run } = branchAwareGitRunner({
      open: true,
      branchText: MAIN_STATUS_WITH_OPEN_ROWS(),
      branchFileSha: BRANCH_FILE_SHA,
    });
    const { base } = harness.start({ description: "# d\n", status: MAIN_ONLY_STATUS, extra: { queueToken: TOKEN, gitRun: run } });
    const html = await overview(base);
    expect(html).toContain(`value="${BRANCH_FILE_SHA}"`);
  });
});

// REQ-3: which rows `checklist()` offers as boxes is decided the same
// way whether its input came off a branch or off disk — and what it
// decides is that the `## Acceptance criteria` rows are the person's
// and the Phase tables are the implement run's own record.
describe("the Acceptance-only rule still holds for a branch read (REQ-3)", () => {
  test("an open Phase row on the branch is not a box, and not on the page", async () => {
    const branchStatus = [
      "# Queue - Status",
      "",
      phaseSection(EARLIER_PHASE, [OPEN_ROW]),
      phaseSection("Acceptance criteria", [EARLIER_DONE_ROW]),
    ].join("\n");
    const { run } = branchAwareGitRunner({ open: true, branchText: branchStatus });
    const { base } = harness.start({ description: "# d\n", status: MAIN_ONLY_STATUS, extra: { queueToken: TOKEN, gitRun: run } });
    const html = await overview(base);
    // The Phase section's own open row is the run's record: no box, and
    // not drawn here at all.
    expect(html).not.toContain('name="tick"');
    expect(html).not.toContain("Manual check at 375px in a real browser");
    // The Acceptance row is the one this page carries — already done
    // here, so a plain mark rather than a box.
    expect(html).toContain("Write the code");
  });
});

describe("a tick writes onto the open branch, not onto main (REQ-4a/REQ-4b)", () => {
  test("REQ-4a: the write pushes a commit onto refs/heads/aide/<folder>, and the shared checkout stays untouched", async () => {
    const { run, calls } = branchAwareGitRunner({ open: true, branchText: MAIN_STATUS_WITH_OPEN_ROWS() });
    const { base, dir } = harness.start({ description: "# d\n", status: MAIN_ONLY_STATUS, extra: { queueToken: TOKEN, gitRun: run } });

    const res = await tick(base, { ticks: [OPEN_ROW], statusBaseSha: BRANCH_FILE_SHA });

    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    const push = calls.find((c) => c.args[0] === "push");
    expect(push?.args.some((a) => a.includes("refs/heads/aide/81-queue-and-runner"))).toBe(true);
    // Never the ordinary `saveSpecFiles` commit-onto-HEAD sequence: no
    // `commit -q -m` against the shared checkout for this write.
    expect(calls.some((c) => c.args[0] === "commit")).toBe(false);
    // main's own disk copy is untouched — the write never reached it.
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(MAIN_ONLY_STATUS);
  });

  test("REQ-4b: a headless run's commit landing between render and Save refuses the tick", async () => {
    const { run } = branchAwareGitRunner({ open: true, branchText: MAIN_STATUS_WITH_OPEN_ROWS(), pushFails: true });
    const { base, dir } = harness.start({ description: "# d\n", status: MAIN_ONLY_STATUS, extra: { queueToken: TOKEN, gitRun: run } });

    const res = await tick(base, { ticks: [OPEN_ROW], statusBaseSha: BRANCH_FILE_SHA });

    expect(res.status).toBe(303);
    // The exact race wording, not just any refusal: proves this went
    // through the branch's own non-force push and was rejected there,
    // rather than merely falling back to `saveSpecFiles`'s own,
    // differently worded baseSha refusal for an unrelated reason.
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("changed on origin while this was being saved");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(MAIN_ONLY_STATUS);
  });

  test("a stale statusBaseSha refuses before anything is pushed", async () => {
    const { run, calls } = branchAwareGitRunner({ open: true, branchText: MAIN_STATUS_WITH_OPEN_ROWS() });
    const { base } = harness.start({ description: "# d\n", status: MAIN_ONLY_STATUS, extra: { queueToken: TOKEN, gitRun: run } });

    const res = await tick(base, { ticks: [OPEN_ROW], statusBaseSha: "some-other-stale-sha" });

    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("changed since you opened it");
    expect(calls.some((c) => c.args[0] === "push")).toBe(false);
  });
});

function MAIN_STATUS_WITH_OPEN_ROWS(): string {
  return ["# Queue - Status", "", phaseSection(PHASE, [DONE_ROW, OPEN_ROW])].join("\n");
}
