// Spec 510, AC-4: the tick route on an ARCHIVED spec. A row marked Not verified
// may be completed or marked Failed with a note; nothing else on the spec moves.
// Route only, against the real `aide-write-spec` and a recorded git runner.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSpecSaveHarness, TICK, ARCHIVED, ARCHIVED_TEXT, DESCRIPTION, FILE_SHA, savable } from "../spec-page/spec-save-fixtures.ts";
import { DONE_ROW, NV_ROW, NV_STATUS, OPEN_ROW, PHASE, STATUS, recording, startWithChecks, statusPath, tick } from "../spec-page/spec-checks-fixtures.ts";
import type { GitRunner } from "../../src/git/branch-status.ts";

const { harness } = createSpecSaveHarness();
afterEach(() => harness.cleanup());

const SECOND_NV = "| AC-5: also after the deploy | Not verified | |";
const TWO_NV = NV_STATUS.replace(NV_ROW, `${NV_ROW}\n${SECOND_NV}`);
const FAILED_ROW = "| AC-6: failed earlier | ❌ Failed | Failed: it did not hold |";
const WITH_FAILED = NV_STATUS.replace(NV_ROW, `${NV_ROW}\n${FAILED_ROW}`);
const CLOSED = `${NV_STATUS}\n**Closed:** 2026-09-01 — no\n`;

const start = (status: string, git: GitRunner = savable("/host")) =>
  harness.start({
    description: DESCRIPTION,
    status: STATUS,
    archivedSpecs: { [ARCHIVED]: { description: ARCHIVED_TEXT, status } },
    extra: { gitRun: git },
  });
const fileOf = (dir: string, name = "4-status.md") => join(dir, "root", "aide", "specs", "archive", ARCHIVED, name);

const press = (
  base: string,
  o: { rows?: string[]; ticks?: string[]; failed?: string[]; notes?: string[]; unverified?: string[] },
) =>
  fetch(`${base}/api/queue/specs/aide/${ARCHIVED}/tick`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams([
      ["checksPhase", PHASE],
      ["statusBaseSha", FILE_SHA],
      ...(o.rows ?? []).map((l): [string, string] => ["row", l]),
      ...(o.ticks ?? []).map((l): [string, string] => ["tick", l]),
      ...(o.failed ?? []).map((l): [string, string] => ["failed", l]),
      ...(o.unverified ?? []).map((l): [string, string] => ["unverified", l]),
      ...(o.notes ?? []).map((n, i): [string, string] => [`failnote-${i}`, n]),
    ]).toString(),
  });

const failedRow = (row: string, note: string) => row.replace(/\| Not verified \|[^|]*\|$/, `| ❌ Failed | Failed: ${note} |`);

describe("an archived spec: a Not verified row can fail with a note (AC-4)", () => {
  test("Failed with a note is written to 4-status.md and 4-status.json in one commit", async () => {
    const git = recording();
    const { base, dir } = start(NV_STATUS, git.run);
    const res = await press(base, { rows: [NV_ROW], failed: [NV_ROW], notes: ["the log shows no row"] });
    expect(res.status).toBe(200);
    expect(readFileSync(fileOf(dir), "utf-8")).toBe(NV_STATUS.replace(NV_ROW, failedRow(NV_ROW, "the log shows no row")));
    const rows: { failed?: boolean; notVerified?: boolean; done: boolean }[] = JSON.parse(
      readFileSync(fileOf(dir, "4-status.json"), "utf-8"),
    ).acceptanceCriteria;
    expect(rows.filter((r) => r.failed)).toHaveLength(1);
    expect(rows.some((r) => r.notVerified)).toBe(false);
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
  });

  test("a pipe and a newline in the note are made safe for the table", async () => {
    const { base, dir } = start(NV_STATUS);
    await press(base, { rows: [NV_ROW], failed: [NV_ROW], notes: ["a | b\nc"] });
    expect(readFileSync(fileOf(dir), "utf-8")).toContain("| ❌ Failed | Failed: a / b c |");
  });

  test("an empty note is refused and nothing is written", async () => {
    const git = recording();
    const { base, dir } = start(NV_STATUS, git.run);
    const res = await press(base, { rows: [NV_ROW], failed: [NV_ROW], notes: ["   "] });
    expect(res.status).toBe(409);
    expect(readFileSync(fileOf(dir), "utf-8")).toBe(NV_STATUS);
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(0);
  });

  test("ticked and Failed together: the tick wins", async () => {
    const { base, dir } = start(NV_STATUS);
    await press(base, { rows: [NV_ROW], ticks: [NV_ROW], failed: [NV_ROW], notes: ["x"] });
    expect(readFileSync(fileOf(dir), "utf-8")).toContain(NV_ROW.replace("Not verified", "✅"));
  });

  test("two Not verified rows: one ticked, the other left alone", async () => {
    const { base, dir } = start(TWO_NV);
    const res = await press(base, { rows: [NV_ROW, SECOND_NV], ticks: [NV_ROW], notes: ["", ""] });
    expect(res.status).toBe(200);
    expect(readFileSync(fileOf(dir), "utf-8")).toBe(TWO_NV.replace(NV_ROW, NV_ROW.replace("Not verified", "✅")));
  });

  test("two Not verified rows: the note belongs to the row at its own position", async () => {
    const { base, dir } = start(TWO_NV);
    await press(base, { rows: [NV_ROW, SECOND_NV], failed: [SECOND_NV], notes: ["", "second broke"] });
    expect(readFileSync(fileOf(dir), "utf-8")).toBe(TWO_NV.replace(SECOND_NV, failedRow(SECOND_NV, "second broke")));
  });
});

describe("an archived spec: nothing else moves (AC-4)", () => {
  const refusals: [string, string, Parameters<typeof press>[1]][] = [
    ["a done row marked Failed", NV_STATUS, { rows: [DONE_ROW], failed: [DONE_ROW], notes: ["x"] }],
    ["a done row unticked", NV_STATUS, { rows: [DONE_ROW, NV_ROW], ticks: [NV_ROW] }],
    ["an open row ticked", NV_STATUS.replace(DONE_ROW, OPEN_ROW), { rows: [OPEN_ROW], ticks: [OPEN_ROW] }],
    ["a Failed row ticked", WITH_FAILED, { rows: [FAILED_ROW], ticks: [FAILED_ROW] }],
    ["a Failed row drawn", WITH_FAILED, { rows: [FAILED_ROW, NV_ROW], ticks: [NV_ROW] }],
    ["a closed spec", CLOSED, { rows: [NV_ROW], ticks: [NV_ROW] }],
  ];
  for (const [name, status, over] of refusals) {
    test(`${name} is refused, nothing is written and nothing is committed`, async () => {
      const git = recording();
      const { base, dir } = start(status, git.run);
      const res = await press(base, over);
      expect(res.status).toBe(409);
      expect(readFileSync(fileOf(dir), "utf-8")).toBe(status);
      expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(0);
    });
  }

  test("a press that leaves the Not verified row alone changes nothing", async () => {
    const git = recording();
    const { base, dir } = start(NV_STATUS, git.run);
    const res = await press(base, { rows: [NV_ROW], notes: [""] });
    expect(res.status).toBe(200);
    expect(readFileSync(fileOf(dir), "utf-8")).toBe(NV_STATUS);
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(0);
  });
});

describe("a live spec: a Failed row is never moved by a press (AC-4)", () => {
  test("the failed field is ignored, and a post naming a Failed row is refused", async () => {
    const live = startWithChecks(harness, savable("/host"), WITH_FAILED);
    const ignored = await tick(live.base, { rows: [NV_ROW], unverified: [NV_ROW] });
    expect(ignored.status).toBe(303);
    const res = await fetch(`${live.base}${TICK}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams([["checksPhase", PHASE], ["row", NV_ROW], ["unverified", NV_ROW], ["failed", NV_ROW], ["row", FAILED_ROW]]).toString(),
    });
    expect(res.status).toBe(409);
    expect(readFileSync(statusPath(live.dir), "utf-8")).toBe(WITH_FAILED);
  });
});
