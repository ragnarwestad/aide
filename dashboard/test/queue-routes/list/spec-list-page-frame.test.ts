// Split out of spec-list-rendering.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ran, statusSaying } from "../../helpers/queue-server.ts";
import { JOB, specControls, phaseDone, OPEN_81, listUntil, rowSaysDone, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

describe("GET / (the spec list, HTML)", () => {

  // A schedule job's tracking key (`schedule-<name>`, spec 259) is
  // exempted from the specFolder-must-exist check so it can be enqueued
  // at all — but nothing excluded it from this list, so it drew a row
  // whose name linked to `/specs/aide/schedule-<name>`, a 404 (there is
  // no such spec folder), and whose action buttons refused every press
  // with "unknown specFolder". Its own history belongs on `/schedule`'s
  // detail page, never here.
  test("draws no row for a schedule job (spec 259/276/277)", async () => {
    const { base } = start();
    const headers = { "content-type": "application/json", accept: "application/json" };
    await fetch(`${base}/api/queue`, {
      method: "POST",
      headers,
      body: JSON.stringify({ project: "aide", specFolder: "schedule-nightly", steps: ["schedule"] }),
    });
    const html = await (await fetch(`${base}/specs`, )).text();
    expect(html).not.toContain("schedule-nightly");
  });

  test("?rows=1 returns the table body alone, for the script to swap in", async () => {
    const { base } = start();
    const headers = { "content-type": "application/json", accept: "application/json" };
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    const rows = await (
      await fetch(`${base}/specs?rows=1&${OPEN_81}`, )
    ).text();
    expect(rows).toContain("<tr");
    expect(rows).toContain("81-queue-and-runner");
    expect(rows).not.toContain("<html");
  });

});

describe("the step boxes on a row follow that spec", () => {
  test("a step the spec has already had is marked done, and its box is offered unticked (criterion 1)", async () => {
    const { base, dir } = start();
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    writeFileSync(join(spec, "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze"]);
    const html = await listUntil(base, rowSaysDone("analyze"));
    const line = specControls(html, "81-queue-and-runner");
    // analyze has run: its box can be ticked again, and is not.
    // Implement is what you came for, so its box is pre-ticked.
    expect(line).toMatch(/name="steps" value="analyze" form/);
    expect(line).not.toMatch(/value="analyze" checked/);
    expect(line).toMatch(/data-phase="implement"[^]*?value="implement"[^>]*checked/);
    expect(phaseDone(line, "analyze")).toBe(true);
  });

});
