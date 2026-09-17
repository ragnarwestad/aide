// Split out of spec-save.test.ts by theme.
//
// Sibling to spec-overview-checks.test.ts: same "the checks on the
// Overview tab" describe from the original file, covering the commit
// message, what a tick refuses, and the archived-spec/retired-route
// guards.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitRunner } from "../../src/git/branch-status.ts";
import {
  SPEC, TICK, PAGE, TOKEN, FILE_SHA, DESCRIPTION, NEW_TEXT, auth, createSpecSaveHarness,
  ARCHIVED, ARCHIVED_TEXT, savable,
} from "./spec-save-fixtures.ts";
import {
  PHASE, OPEN_ROW, DONE_ROW, STATUS, statusPath, startWithChecks as start, tick, save,
  recording, messageOf,
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
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
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
      extra: { queueToken: TOKEN, gitRun: savable("/host") },
    });
    const res = await fetch(`${base}/api/queue/specs/aide/${ARCHIVED}/tick`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
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
      extra: { queueToken: TOKEN, gitRun: savable("/host") },
    });
    // ?tab=checks, not the bare URL: spec 294 (landed the same day)
    // made Description the default tab and renamed this one from
    // "Overview" to "Checks" — the bare URL no longer serves it.
    const html = await (await fetch(`${base}/specs/aide/${ARCHIVED}?tab=checks`, auth)).text();
    expect(html).toContain("Manual check at 375px in a real browser");
    expect(html).not.toContain('name="tick"');
  });
});

// `4-status.md` is a record, not a document to write: the tracking block
// is the run's own stamp and the phase tables are its log of what it
// did. The one thing in it a person decides is the acceptance checks,
// and the Checks tab now both puts a check on and takes one back off —
// so nothing is left that a hand edit was the only way to do.
describe("4-status.md cannot be saved as a document", () => {
  test("a Save of it is refused, and the file is untouched", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await fetch(`${base}/api/queue/specs/aide/81-queue-and-runner/save`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
      body: new URLSearchParams([["file", "4-status.md"], ["text", "# rewritten\n"], ["baseSha", FILE_SHA]]).toString(),
    });
    const where = decodeURIComponent(res.headers.get("location")!);
    expect(where).toContain("error=");
    expect(where).toContain("Checks tab");
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
