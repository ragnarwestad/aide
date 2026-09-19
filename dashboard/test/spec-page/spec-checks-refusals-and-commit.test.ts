// Split out of spec-save.test.ts by theme.
//
// Sibling to spec-overview-checks.test.ts: same "the checks on the
// Overview tab" describe from the original file, covering the commit
// message, what a tick refuses, and the archived-spec/retired-route
// guards.

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { GitRunner } from "../../src/git/branch-status.ts";
import { SPEC, TICK, PAGE, FILE_SHA, DESCRIPTION, NEW_TEXT, createSpecSaveHarness, ARCHIVED, ARCHIVED_TEXT, savable } from "./spec-save-fixtures.ts";
import {
  PHASE, OPEN_ROW, DONE_ROW, STATUS, ticked, statusPath, startWithChecks as start, tick, save,
  recording, messageOf, branchAwareGitRunner, NV_ROW, NV_STATUS, marked, SECOND_OPEN_ROW,
} from "./spec-checks-fixtures.ts";
import { afterTick } from "../../src/serve/routes/spec-edit/checks.ts";

const { harness } = createSpecSaveHarness();
afterEach(() => harness.cleanup());
const startWithChecks = (gitRun: GitRunner, status = STATUS) => start(harness, gitRun, status);

describe("the checks on the Overview tab", () => {
  describe("the commit message", () => {
    test("a tick reads as a check made by hand, not as an edit", async () => {
      const git = recording();
      const { base } = startWithChecks(git.run);
      await tick(base, { ticks: [OPEN_ROW] });
      expect(messageOf(git.calls)).toBe(`Tick a check in 4-status.md for ${SPEC} by hand from the dashboard`);
    });

    test("a description edit still reads exactly as it did", async () => {
      const git = recording();
      const { base } = startWithChecks(git.run);
      await save(base, { text: NEW_TEXT });
      expect(messageOf(git.calls)).toBe(`Edit 1-description.md for ${SPEC} from the dashboard`);
    });

  });

  // --- criterion 7: a tick that cannot go through changes nothing -----------

  test("a 4-status.md that moved under the reader refuses the tick", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await tick(base, { ticks: [OPEN_ROW], statusBaseSha: "0000000ffffff" });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location.startsWith(PAGE)).toBe(true);
    expect(location).toContain("changed since");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  // The sha still matches — the same commit — but the row does not: the
  // reader sat on the page while a step rewrote the table around it.
  test("a tick naming a row that no longer reads as it did is refused", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await tick(base, {
      ticks: ["| Manual check at 375px in a real browser | ⬜ | as it once was |"],
    });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location.startsWith(PAGE)).toBe(true);
    expect(location).toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  // One row that is not there refuses the whole press, the rows beside
  // it included — never applied silently while one of them is dropped.
  test("one bad row refuses every box in the same press", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await tick(base, { ticks: [OPEN_ROW, "| No such row | ⬜ | |"] });
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  // A row that comes back ticked exactly as it went out is a row the
  // reader did not touch. Nothing moved, so nothing is committed — and
  // it is not a refusal either, since a press that leaves one box alone
  // and clears another is one ordinary press.
  test("a row left exactly as it was commits nothing, and is not an error", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await tick(base, { ticks: [DONE_ROW] });
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  // The whole point of the boxes being boxes: a check made by mistake
  // comes back off here, not by editing the markdown table by hand.
  test("a done row the reader left CLEAR goes back to ⬜, and is committed", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await tick(base, { ticks: [], rows: [DONE_ROW] });
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    const after = readFileSync(statusPath(dir), "utf-8");
    expect(after).not.toBe(STATUS);
    expect(after).toContain(DONE_ROW.replace("✅", "⬜"));
    expect(after).not.toContain(DONE_ROW);
  });

  // A row the form never drew is never answered for. Without this, a
  // press from a page drawn before a run added a row would clear the
  // new one on the reader's behalf.
  test("a row the press did not carry is left exactly as it was", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await tick(base, { ticks: [OPEN_ROW], rows: [OPEN_ROW] });
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toContain(DONE_ROW);
  });

  test("a phase the file does not have is refused", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await tick(base, { ticks: [OPEN_ROW], phase: "Phase 9: NOTHING" });
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  // A body with boxes but no phase to read them against is a request
  // that never came from this form.
  test("ticks with no phase named are refused rather than guessed at", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await fetch(`${base}${TICK}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: new URLSearchParams([["statusBaseSha", FILE_SHA], ["tick", OPEN_ROW]]).toString(),
    });
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  // Spec 163: an archived spec is a record, and the guard is on the
  // route — hiding the boxes leaves it live for anyone with the URL.
  test("an archived spec's checks cannot be ticked", async () => {
    const { base, dir } = harness.start({
      description: DESCRIPTION,
      status: STATUS,
      archivedSpecs: { [ARCHIVED]: { description: ARCHIVED_TEXT, status: STATUS } },
      extra: { gitRun: savable("/host") },
    });
    const res = await fetch(`${base}/api/queue/specs/aide/${ARCHIVED}/tick`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: new URLSearchParams([
        ["checksPhase", PHASE],
        ["statusBaseSha", FILE_SHA],
        ["tick", OPEN_ROW],
      ]).toString(),
    });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("archived");
    expect(readFileSync(join(dir, "root", "aide", "specs", "archive", ARCHIVED, "4-status.md"), "utf-8")).toBe(STATUS);
  });

  test("and its Overview offers no box to press", async () => {
    const { base } = harness.start({
      description: DESCRIPTION,
      status: STATUS,
      archivedSpecs: { [ARCHIVED]: { description: ARCHIVED_TEXT, status: STATUS } },
      extra: { gitRun: savable("/host") },
    });
    // ?tab=status, not the bare URL: spec 294 (landed the same day)
    // made Description the default tab and renamed this one from
    // "Overview" to "Checks" — the bare URL no longer serves it.
    const html = await (await fetch(`${base}/specs/aide/${ARCHIVED}?tab=status`)).text();
    expect(html).toContain("Manual check at 375px in a real browser");
    expect(html).not.toContain('name="tick"');
  });
});

// `4-status.md` is a record, not a document to write: the tracking block
// is the run's own stamp and the phase tables are its log of what it
// did. The one thing in it a person decides is the acceptance checks,
// and the Status tab now both puts a check on and takes one back off —
// so nothing is left that a hand edit was the only way to do.
describe("4-status.md cannot be saved as a document", () => {
  test("a Save of it is refused, and the file is untouched", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await fetch(`${base}/api/queue/specs/aide/81-queue-and-runner/save`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: new URLSearchParams([["file", "4-status.md"], ["text", "# rewritten\n"], ["baseSha", FILE_SHA]]).toString(),
    });
    const where = decodeURIComponent(res.headers.get("location")!);
    expect(where).toContain("error=");
    expect(where).toContain("Status tab");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });
});

// --- a saved tick is read again before the reader is sent back -----------
// A saved tick changes the branch copy of the spec's state file, which
// the Specs list reads through a cache to decide whether to say
// "archive held back: the Acceptance criteria are not all ticked". Only
// marked due, the old answer went on being served until the schedule's
// next read, and the reader who had just ticked the last row was told
// to go and tick it.

describe("after a tick is saved", () => {
  test("the answer is read again, and the list's scan dropped, before the reader is sent back", async () => {
    const order: string[] = [];
    let release = (): void => {};
    const reread = new Promise<void>((r) => (release = r));
    const done = afterTick(
      {
        forgetBranchFileSteps: (dir, folder) => void order.push(`forget ${dir} ${folder}`),
        rereadSpec: async (dir, folder) => {
          order.push(`reread ${dir} ${folder}`);
          await reread;
          order.push("reread finished");
        },
        invalidateScan: () => void order.push("scan dropped"),
      },
      "/specs/aide/481-x",
      "481-x",
    );
    await Bun.sleep(5);
    // Not back to the reader yet: the read is still going.
    expect(order).toEqual(["forget /specs/aide/481-x 481-x", "reread /specs/aide/481-x 481-x"]);
    release();
    await done;
    expect(order).toEqual([
      "forget /specs/aide/481-x 481-x",
      "reread /specs/aide/481-x 481-x",
      "reread finished",
      "scan dropped",
    ]);
  });

  test("a read that fails still lets the reader back, with the scan dropped", async () => {
    const order: string[] = [];
    await afterTick(
      {
        rereadSpec: async () => {
          throw new Error("git is gone");
        },
        invalidateScan: () => void order.push("scan dropped"),
      },
      "/specs/aide/481-x",
      "481-x",
    );
    expect(order).toEqual(["scan dropped"]);
  });
});

// --- spec 509: the Not verified mark through the tick route --------------------

describe("the tick route and the Not verified mark (spec 509)", () => {
  const ok = (res: Response) => expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
  const refused = (res: Response) => expect(decodeURIComponent(res.headers.get("location")!)).toContain("error=");
  const stateOf = (dir: string) => JSON.parse(readFileSync(join(dirname(statusPath(dir)), "4-status.json"), "utf-8"));
  const NV_FILE = STATUS.replace(SECOND_OPEN_ROW, NV_ROW);
  const asNv = (row: string) => marked(row);

  test("the Not verified box alone marks an open row, in one commit with the state (AC-1)", async () => {
    const git = recording();
    const { base, dir } = startWithChecks(git.run);
    ok(await tick(base, { unverified: [OPEN_ROW] }));
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS.replace(OPEN_ROW, asNv(OPEN_ROW)));
    const row = stateOf(dir).acceptanceCriteria.find((r: { task: string }) => r.task.startsWith("Manual check"));
    expect(row).toEqual({ task: "Manual check at 375px in a real browser", done: true, notVerified: true });
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
    const added = git.calls.filter((c) => c[0] === "add").map((c) => c.join(" ")).join(" ");
    expect(added).toContain("4-status.md");
    expect(added).toContain("4-status.json");
  });

  test("both boxes on a done row make it Not verified (AC-1)", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    ok(await tick(base, { ticks: [DONE_ROW], unverified: [DONE_ROW] }));
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS.replace(DONE_ROW, asNv(DONE_ROW)));
  });

  test("both boxes on an open row make it done (AC-1)", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    ok(await tick(base, { ticks: [OPEN_ROW], unverified: [OPEN_ROW] }));
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS.replace(OPEN_ROW, ticked(OPEN_ROW)));
  });

  test("both boxes on a Not verified row make it done (AC-1)", async () => {
    const { base, dir } = startWithChecks(savable("/host"), NV_FILE);
    ok(await tick(base, { ticks: [NV_ROW], unverified: [NV_ROW] }));
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(NV_FILE.replace(NV_ROW, NV_ROW.replace("Not verified", "✅")));
  });

  test("the tick box alone on a Not verified row makes it done, not skipped as already made (AC-1)", async () => {
    const { base, dir } = startWithChecks(savable("/host"), NV_FILE);
    ok(await tick(base, { ticks: [NV_ROW] }));
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(NV_FILE.replace(NV_ROW, NV_ROW.replace("Not verified", "✅")));
  });

  test("no box on a Not verified row sends it back to open (AC-1)", async () => {
    const { base, dir } = startWithChecks(savable("/host"), NV_FILE);
    ok(await tick(base, { rows: [NV_ROW] }));
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(NV_FILE.replace(NV_ROW, NV_ROW.replace("Not verified", "⬜")));
  });

  test("a Not verified row left as it was commits nothing (AC-1)", async () => {
    const git = recording();
    const { base } = startWithChecks(git.run, NV_FILE);
    ok(await tick(base, { unverified: [NV_ROW] }));
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(0);
  });

  test("ticking the last Not verified row leaves no notVerified row in the state (AC-6)", async () => {
    const { base, dir } = startWithChecks(savable("/host"), NV_STATUS);
    ok(await tick(base, { ticks: [DONE_ROW, NV_ROW] }));
    const rows: { done: boolean; notVerified?: boolean }[] = stateOf(dir).acceptanceCriteria;
    expect(rows.every((r) => r.done && !("notVerified" in r))).toBe(true);
  });

  test("an installed aide-write-spec that derives no flag refuses, and nothing is committed (AC-18)", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "old-write-spec-"));
    const stub = join(scratch, "old-write-spec");
    const state = JSON.stringify({ completedPhases: [], acceptanceCriteria: [{ task: "x", done: true }], phaseCounts: {} });
    writeFileSync(stub, `#!/bin/bash\ncat > /dev/null\nprintf '%s\\n' '${JSON.stringify({ ok: true, stateJson: state })}'\n`);
    chmodSync(stub, 0o755);
    const before = process.env.AIDE_WRITE_SPEC_BIN;
    process.env.AIDE_WRITE_SPEC_BIN = stub;
    try {
      const git = recording();
      const { base, dir } = startWithChecks(git.run);
      const res = await tick(base, { unverified: [OPEN_ROW] });
      refused(res);
      expect(decodeURIComponent(res.headers.get("location")!)).toContain("older than the dashboard");
      expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
      expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(0);
    } finally {
      process.env.AIDE_WRITE_SPEC_BIN = before;
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  // --- an archived spec: only a deferred check may still be completed ---------

  describe("an archived spec", () => {
    const ARCHIVED_STATUS = NV_STATUS;
    const start = (status = ARCHIVED_STATUS, git: GitRunner = savable("/host")) =>
      harness.start({
        description: DESCRIPTION,
        status: STATUS,
        archivedSpecs: { [ARCHIVED]: { description: ARCHIVED_TEXT, status } },
        extra: { gitRun: git },
      });
    const tickArchived = (base: string, over: Parameters<typeof tick>[1]) =>
      tick(base, { ...over, path: `/api/queue/specs/aide/${ARCHIVED}/tick` });
    const fileOf = (dir: string, name = "4-status.md") => join(dir, "root", "aide", "specs", "archive", ARCHIVED, name);

    test("the Not verified row can be completed, and 4-status.md and 4-status.json are committed (AC-5)", async () => {
      const git = recording();
      const { base, dir } = start(ARCHIVED_STATUS, git.run);
      ok(await tickArchived(base, { ticks: [NV_ROW] }));
      expect(readFileSync(fileOf(dir), "utf-8")).toBe(ARCHIVED_STATUS.replace(NV_ROW, NV_ROW.replace("Not verified", "✅")));
      const rows: { notVerified?: boolean }[] = JSON.parse(readFileSync(fileOf(dir, "4-status.json"), "utf-8")).acceptanceCriteria;
      expect(rows.some((r) => r.notVerified)).toBe(false);
      expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
    });

    test("it writes to the specs repository's default branch even when a branch of that name is open (AC-5)", async () => {
      const open = branchAwareGitRunner({ folder: ARCHIVED, branchText: ARCHIVED_STATUS });
      const { base, dir } = start(ARCHIVED_STATUS, open.run);
      ok(await tickArchived(base, { ticks: [NV_ROW] }));
      expect(readFileSync(fileOf(dir), "utf-8")).toContain(NV_ROW.replace("Not verified", "✅"));
      expect(open.calls.some((c) => c.args[0] === "commit-tree")).toBe(false);
    });

    test("un-ticking the done row, un-marking the Not verified row or marking another is refused (AC-5)", async () => {
      const tries: Parameters<typeof tick>[1][] = [
        { rows: [DONE_ROW, NV_ROW], ticks: [NV_ROW] },
        { rows: [NV_ROW] },
        { ticks: [DONE_ROW], unverified: [DONE_ROW, NV_ROW] , rows: [DONE_ROW, NV_ROW] },
      ];
      for (const over of tries) {
        const git = recording();
        const { base, dir } = start(ARCHIVED_STATUS, git.run);
        const res = await tickArchived(base, over);
        refused(res);
        expect(decodeURIComponent(res.headers.get("location")!)).toContain("archived");
        expect(readFileSync(fileOf(dir), "utf-8")).toBe(ARCHIVED_STATUS);
        expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(0);
        harness.cleanup();
      }
    });

    test("a closed spec refuses every change (AC-5)", async () => {
      const closed = `${NV_STATUS}\n- **Closed:** 2026-09-01\n`;
      const { base, dir } = start(closed);
      const res = await tickArchived(base, { ticks: [NV_ROW] });
      refused(res);
      expect(readFileSync(fileOf(dir), "utf-8")).toBe(closed);
    });
  });
});
