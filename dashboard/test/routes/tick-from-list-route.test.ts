// Spec 493: the tick route as the Specs list presses it, `?fromList=1` on
// the action URL. The write is the Checks tab's own.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SPEC, TICK, DESCRIPTION, createSpecSaveHarness, ARCHIVED, ARCHIVED_TEXT, savable } from "../spec-page/spec-save-fixtures.ts";
import {
  PHASE, OPEN_ROW, SECOND_OPEN_ROW, DONE_ROW, STATUS, heldBack, statusPath, startWithChecks, recording, messageOf, tick, ticked,
} from "../spec-page/spec-checks-fixtures.ts";

const a = createSpecSaveHarness();
const b = createSpecSaveHarness();
afterEach(() => {
  a.harness.cleanup();
  b.harness.cleanup();
});

const listPress = (
  base: string,
  o: { ticks?: string[]; unverified?: string[]; rows?: string[]; phase?: string; path?: string } = {},
) =>
  fetch(`${base}${o.path ?? TICK}?fromList=1`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    redirect: "manual",
    body: new URLSearchParams([
      ["checksPhase", o.phase ?? PHASE],
      ...(o.rows ?? [...(o.ticks ?? []), ...(o.unverified ?? [])]).map((l): [string, string] => ["row", l]),
      ...(o.ticks ?? []).map((l): [string, string] => ["tick", l]),
      ...(o.unverified ?? []).map((l): [string, string] => ["unverified", l]),
    ]).toString(),
  });

describe("a press from the Specs list", () => {
  test("writes exactly what the Checks tab's own press writes, with the same commit message", async () => {
    const tab = recording();
    const t = startWithChecks(a.harness, tab.run);
    await tick(t.base, { ticks: [OPEN_ROW], rows: [DONE_ROW, OPEN_ROW, SECOND_OPEN_ROW] });
    const list = recording();
    const l = startWithChecks(b.harness, list.run);
    const res = await listPress(l.base, { ticks: [OPEN_ROW], rows: [DONE_ROW, OPEN_ROW, SECOND_OPEN_ROW] });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(readFileSync(statusPath(l.dir), "utf-8")).toBe(readFileSync(statusPath(t.dir), "utf-8"));
    expect(readFileSync(statusPath(l.dir), "utf-8")).toContain(ticked(OPEN_ROW));
    expect(messageOf(list.calls)).toBe(messageOf(tab.calls));
  });

  test("the Not verified box from the list marks the row, and the tick box then completes it (AC-1)", async () => {
    const { base, dir } = startWithChecks(a.harness, savable("/host"));
    const marked = OPEN_ROW.replace("| ⬜ |", "| Not verified |");
    expect((await listPress(base, { unverified: [OPEN_ROW] })).status).toBe(200);
    expect(readFileSync(statusPath(dir), "utf-8")).toContain(marked);
    expect((await listPress(base, { ticks: [marked] })).status).toBe(200);
    expect(readFileSync(statusPath(dir), "utf-8")).toContain(ticked(OPEN_ROW));
  });

  test("the last tick takes the hold-back section off the file", async () => {
    const { base, dir } = startWithChecks(a.harness, savable("/host"), heldBack([DONE_ROW, OPEN_ROW]));
    const res = await listPress(base, { ticks: [DONE_ROW, OPEN_ROW] });
    expect(res.status).toBe(200);
    expect(readFileSync(statusPath(dir), "utf-8")).not.toContain("## Archive held back");
  });

  test("a box the reader cleared goes back to open", async () => {
    const { base, dir } = startWithChecks(a.harness, savable("/host"));
    const res = await listPress(base, { ticks: [], rows: [DONE_ROW] });
    expect(res.status).toBe(200);
    expect(readFileSync(statusPath(dir), "utf-8")).toContain(DONE_ROW.replace("| ✅ |", "| ⬜ |"));
  });

  test("saving does not start an archive, or any other job", async () => {
    const { base } = startWithChecks(a.harness, savable("/host"), heldBack([OPEN_ROW]));
    const jobs = async () =>
      (await (await fetch(`${base}/api/queue`, { headers: { accept: "application/json" } })).json()).jobs;
    expect(await jobs()).toEqual([]);
    const res = await listPress(base, { ticks: [OPEN_ROW] });
    expect(res.status).toBe(200);
    expect(await jobs()).toEqual([]);
  });
});

describe("a press that cannot be saved", () => {
  const MOVED = "| Manual check at 375px in a real browser | ⬜ | as it once was |";

  test("a row that changed: JSON answers 409 naming the spec, and nothing is written", async () => {
    const { base, dir } = startWithChecks(a.harness, savable("/host"));
    const res = await listPress(base, { ticks: [MOVED] });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.spec).toBe(`aide/${SPEC}`);
    expect(typeof body.error).toBe("string");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  test("an archived spec: JSON answers 409", async () => {
    const { base } = a.harness.start({
      description: DESCRIPTION,
      status: STATUS,
      archivedSpecs: { [ARCHIVED]: { description: ARCHIVED_TEXT, status: STATUS } },
      extra: { gitRun: savable("/host") },
    });
    const res = await listPress(base, { ticks: [OPEN_ROW], path: `/api/queue/specs/aide/${ARCHIVED}/tick` });
    expect(res.status).toBe(409);
    expect((await res.json()).spec).toBe(`aide/${ARCHIVED}`);
  });
});
