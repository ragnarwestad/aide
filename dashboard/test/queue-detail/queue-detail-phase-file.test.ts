// Split out of queue-detail.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IMPLEMENTED } from "../helpers/queue-server.ts";
import { detailHarness, enqueue } from "./queue-detail-fixtures.ts";

const { start } = detailHarness(IMPLEMENTED);

// --- the Update button -------------------------------------------------------

describe("a running implement's TDD phase reaches the page", () => {
  const seedRunning = (dir: string, id: string, sessionId: string): string => {
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === id)!;
    job.state = "running";
    job.startedAt = "2026-08-23T10:00:00Z";
    job.sessionId = sessionId;
    writeFileSync(mirror, JSON.stringify(jobs));
    return mirror;
  };

  const report = (base: string, sessionId: string, phase: string) =>
    fetch(`${base}/api/aide-run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: "laptop", sessionId, command: "implement", phase }),
    });

  // The fetch happens IMMEDIATELY
  // after the report, with no wait. The store write and the row's lookup
  // are both synchronous, so nothing in this feature adds a delay of its
  // own on top of whatever already carries a queue change to a reader.
  test("a phase reported a moment ago is on the very next render", async () => {
    const { base, dir } = start();
    const id = await enqueue(base, ["implement"]);
    const mirror = seedRunning(dir, id, "sess-210-green");

    const { base: base2 } = start({ queueMirrorPath: mirror });
    expect((await report(base2, "sess-210-green", "green")).status).toBe(200);
    const html = await (
      await fetch(`${base2}/?open=aide/81-queue-and-runner`)
    ).text();
    expect(html).toContain("Running (green)");
    expect(html).toContain('data-third="1"');
  });

  // Where the rule that decides it actually lives: only
  // `implement` reports its thirds, and only `implement` is looked up.
  // An analyze step running in a session the store HAS an answer for is
  // the case that would go wrong quietly — the join key is the session,
  // and a session runs one step after another.
  test("a running analyze is not given a phase, even when its session reported one", async () => {
    const { base, dir } = start();
    const id = await enqueue(base, ["analyze"]);
    const mirror = seedRunning(dir, id, "sess-210-analyze");

    const { base: base2 } = start({ queueMirrorPath: mirror });
    expect((await report(base2, "sess-210-analyze", "green")).status).toBe(200);
    const rows = await (
      await fetch(`${base2}/?rows=1&open=aide/81-queue-and-runner`)
    ).text();
    expect(rows).toContain("running");
    expect(rows).not.toContain("running (");
    expect(rows).not.toContain("data-third");
  });
});
