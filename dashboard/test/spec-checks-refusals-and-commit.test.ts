// Split out of spec-save.test.ts by theme.
//
// Sibling to spec-overview-checks.test.ts: same "the checks on the
// Overview tab" describe from the original file, covering the commit
// message, what a tick refuses, and the archived-spec/retired-route
// guards.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitRunner } from "../src/git/branch-status.ts";
import {
  SPEC, TICK, PAGE, TOKEN, FILE_SHA, DESCRIPTION, NEW_TEXT, auth, createSpecSaveHarness,
  ARCHIVED, ARCHIVED_TEXT, savable,
} from "./spec-save-fixtures.ts";
import {
  PHASE, OPEN_ROW, DONE_ROW, STATUS, statusPath, startWithChecks as start, tick, save,
  recording, messageOf,
} from "./spec-checks-fixtures.ts";

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

    // The sentence that named both files in one commit has nothing left
    // to describe: two files can no longer arrive in one request.
    test("no commit names both files any more", async () => {
      const git = recording();
      const { base } = startWithChecks(git.run);
      await save(base, { text: NEW_TEXT });
      await tick(base, { ticks: [OPEN_ROW] });
      for (const call of git.calls.filter((c) => c[0] === "commit")) {
        expect(call.join(" ")).not.toContain("and tick a check");
      }
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

  test("a row that is already done is refused rather than committed again", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await tick(base, { ticks: [DONE_ROW] });
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
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

  // --- the route spec 188 removed is still gone ----------------------------
  //
  // Deliberate, and a test rather than an absence: `/status/tick` wrote
  // and committed on the press of one box, with no Save at all. The
  // form spec 212 gives back is a different thing — every box on it is
  // posted by one Save — and it lives at `/tick`.
  test("the old per-box route is gone — the URL answers 404", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await fetch(`${base}/api/queue/specs/aide/${SPEC}/status/tick`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
      body: new URLSearchParams({ phase: PHASE, line: OPEN_ROW, baseSha: FILE_SHA }).toString(),
    });
    expect(res.status).toBe(404);
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });
});
