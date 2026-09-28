// Split out of spec-list-rendering.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ran, statusSaying } from "../../helpers/queue-server.ts";
import { JOB, specHead, specPanel, specControls, phaseDone, OPEN_81, listUntil, rowSaysDone, setupQueueRoutesHarness } from "../fixtures.ts";

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
    const html = await (await fetch(`${base}/`, )).text();
    expect(html).not.toContain("schedule-nightly");
  });

  test("?rows=1 returns the table body alone, for the script to swap in", async () => {
    const { base } = start();
    const headers = { "content-type": "application/json", accept: "application/json" };
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    const rows = await (
      await fetch(`${base}/?rows=1&${OPEN_81}`, )
    ).text();
    expect(rows).toContain("<tr");
    expect(rows).toContain("81-queue-and-runner");
    expect(rows).not.toContain("<html");
  });

});

describe("every row answers for itself", () => {
  // Spec 93 put this reason in ONE place, above the table, and said so:
  // "it belongs to the PAGE, not to one control". That held while the
  // page had one form; it lists up to 25 rows, and a reason attached to
  // none of them does not say which button was pressed. Spec 99 moved
  // it onto the row that posted it — the same reason, read off the same
  // query string, one row further down.
  test("a refusal is shown once, on the row that posted it (criterion 6)", async () => {
    const { base } = start();
    const post = () =>
      fetch(`${base}/api/queue`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "analyze" }),
      });
    await post();
    const refused = await post();
    expect(refused.status).toBe(303);
    const location = refused.headers.get("location") ?? "";
    expect(location.startsWith("/?error=")).toBe(true);
    const html = await (await fetch(`${base}${location}`, )).text();
    // In the row's own panel since spec 151, not in the name cell.
    expect(specPanel(html, "81-queue-and-runner")).toContain("already queued");
    expect(specHead(html, "81-queue-and-runner")).not.toContain("already queued");
    // Once, not twice: the banner is the fallback for a refusal that
    // belongs to no row.
    expect(html).not.toContain('<p class="refusal">');
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
