// Spec 493: the tick route as the Specs list presses it. The write is the
// Checks tab's own; what differs is the answer — JSON when asked, the list
// when the press is a form post from it.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SPEC, TICK, TOKEN, DESCRIPTION, createSpecSaveHarness, ARCHIVED, ARCHIVED_TEXT, savable } from "../spec-page/spec-save-fixtures.ts";
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
  o: { ticks?: string[]; rows?: string[]; json?: boolean; view?: string; phase?: string; path?: string } = {},
) =>
  fetch(`${base}${o.path ?? TICK}?fromList=1`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-aide-token": TOKEN,
      ...(o.json ? { accept: "application/json" } : {}),
    },
    redirect: "manual",
    body: new URLSearchParams([
      ["checksPhase", o.phase ?? PHASE],
      ...(o.view ? ([["view.checks", o.view]] as [string, string][]) : []),
      ...(o.rows ?? o.ticks ?? []).map((l): [string, string] => ["row", l]),
      ...(o.ticks ?? []).map((l): [string, string] => ["tick", l]),
    ]).toString(),
  });

const location = (res: Response) => decodeURIComponent(res.headers.get("location") ?? "");

describe("a press from the Specs list", () => {
  test("writes exactly what the Checks tab's own press writes, with the same commit message", async () => {
    const tab = recording();
    const t = startWithChecks(a.harness, tab.run);
    await tick(t.base, { ticks: [OPEN_ROW], rows: [DONE_ROW, OPEN_ROW, SECOND_OPEN_ROW] });
    const list = recording();
    const l = startWithChecks(b.harness, list.run);
    const res = await listPress(l.base, { json: true, ticks: [OPEN_ROW], rows: [DONE_ROW, OPEN_ROW, SECOND_OPEN_ROW] });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(readFileSync(statusPath(l.dir), "utf-8")).toBe(readFileSync(statusPath(t.dir), "utf-8"));
    expect(readFileSync(statusPath(l.dir), "utf-8")).toContain(ticked(OPEN_ROW));
    expect(messageOf(list.calls)).toBe(messageOf(tab.calls));
  });

  test("the last tick takes the hold-back section off the file", async () => {
    const { base, dir } = startWithChecks(a.harness, savable("/host"), heldBack([DONE_ROW, OPEN_ROW]));
    const res = await listPress(base, { json: true, ticks: [DONE_ROW, OPEN_ROW] });
    expect(res.status).toBe(200);
    expect(readFileSync(statusPath(dir), "utf-8")).not.toContain("## Archive held back");
  });

  test("a box the reader cleared goes back to open", async () => {
    const { base, dir } = startWithChecks(a.harness, savable("/host"));
    const res = await listPress(base, { json: true, ticks: [], rows: [DONE_ROW] });
    expect(res.status).toBe(200);
    expect(readFileSync(statusPath(dir), "utf-8")).toContain(DONE_ROW.replace("| ✅ |", "| ⬜ |"));
  });

  test("saving does not start an archive, or any other job", async () => {
    const { base } = startWithChecks(a.harness, savable("/host"), heldBack([OPEN_ROW]));
    const jobs = async () =>
      (await (await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN, accept: "application/json" } })).json()).jobs;
    expect(await jobs()).toEqual([]);
    const res = await listPress(base, { json: true, ticks: [OPEN_ROW] });
    expect(res.status).toBe(200);
    expect(await jobs()).toEqual([]);
  });
});

describe("a press that cannot be saved", () => {
  const MOVED = "| Manual check at 375px in a real browser | ⬜ | as it once was |";

  test("a row that changed: JSON answers 409 naming the spec, and nothing is written", async () => {
    const { base, dir } = startWithChecks(a.harness, savable("/host"));
    const res = await listPress(base, { json: true, ticks: [MOVED] });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.spec).toBe(`aide/${SPEC}`);
    expect(typeof body.error).toBe("string");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  test("a row that changed, script off: back to the list with the error, the spec and the view", async () => {
    const { base } = startWithChecks(a.harness, savable("/host"));
    const res = await listPress(base, { ticks: [MOVED], view: `aide/${SPEC}` });
    expect(res.status).toBe(303);
    const to = location(res);
    expect(to.startsWith("/?")).toBe(true);
    expect(to).toContain("error=");
    expect(to).toContain(`errorSpec=aide/${SPEC}`);
    expect(to).toContain(`checks=aide/${SPEC}`);
  });

  test("an archived spec: JSON answers 409", async () => {
    const { base } = a.harness.start({
      description: DESCRIPTION,
      status: STATUS,
      archivedSpecs: { [ARCHIVED]: { description: ARCHIVED_TEXT, status: STATUS } },
      extra: { queueToken: TOKEN, gitRun: savable("/host") },
    });
    const res = await listPress(base, { json: true, ticks: [OPEN_ROW], path: `/api/queue/specs/aide/${ARCHIVED}/tick` });
    expect(res.status).toBe(409);
    expect((await res.json()).spec).toBe(`aide/${ARCHIVED}`);
  });

  test("an archived spec, script off: answered on the list, without the view", async () => {
    const { base } = a.harness.start({
      description: DESCRIPTION,
      status: STATUS,
      archivedSpecs: { [ARCHIVED]: { description: ARCHIVED_TEXT, status: STATUS } },
      extra: { queueToken: TOKEN, gitRun: savable("/host") },
    });
    const res = await listPress(base, { ticks: [OPEN_ROW], view: `aide/${ARCHIVED}`, path: `/api/queue/specs/aide/${ARCHIVED}/tick` });
    const to = location(res);
    expect(to.startsWith("/?")).toBe(true);
    expect(to).toContain(`errorSpec=aide/${ARCHIVED}`);
    expect(to).not.toContain("checks=");
  });
});

describe("the Checks tab is answered as it always was", () => {
  test("a refusal goes back to the tab, not to the list", async () => {
    const { base } = startWithChecks(a.harness, savable("/host"));
    const res = await tick(base, { ticks: ["| Manual check at 375px in a real browser | ⬜ | as it once was |"] });
    expect(location(res).startsWith(`/specs/aide/${SPEC}?tab=checks`)).toBe(true);
  });
});
