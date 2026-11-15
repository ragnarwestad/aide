// Split out of queue-detail.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerOptions } from "../../src/serve/serve.ts";
import { queueHarness, IMPLEMENTED } from "../helpers/queue-server.ts";

const DESCRIPTION =
  "# A running job is a black box - Description\n\n" +
  "## Table of contents\n\n- [Description](#description)\n\n---\n\n" +
  "## Description\n\nThe queue shows state, step and cost. It shows nothing about " +
  "what the job IS, and nothing about what it is doing.\n\n---\n\n" +
  "## Related documents\n\n- [2-analysis.md](./2-analysis.md)\n";

const harness = queueHarness("aide-queue-detail-", IMPLEMENTED);

const start = (extra: Partial<ServerOptions> = {}) =>
  harness.start({ description: DESCRIPTION, extra: { ...extra } });

afterEach(() => harness.cleanup());

async function enqueue(base: string, steps: string[] = ["analyze"]): Promise<string> {
  const res = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps }),
  });
  const body = (await res.json()) as { job: { id: string } };
  return body.job.id;
}

// A phase's own page shows what that phase made, and nothing else of
// the spec.
describe("a phase job's page shows that phase's file", () => {
  const SPEC = "81-queue-and-runner";

  const withFiles = (dir: string): void => {
    const spec = join(dir, "root", "aide", "specs", SPEC);
    writeFileSync(join(spec, "2-analysis.md"), "# Q - Analysis\n\n## Findings\n\nSeven files.\n");
    writeFileSync(
      join(spec, "3-solution.md"),
      "# Q - Solution\n\n## Plan review\n\nOne must-fix.\n\n## Risk analysis\n\nMedium.\n",
    );
  };

  // The plan and the review of it are one step's work, so
  // the analyze job's page is 3-solution.md whole — both sections, and
  // not the analysis the step wrote on the way there.
  test("an analyze job shows 3-solution.md, review section and all", async () => {
    const { base, dir } = start();
    withFiles(dir);
    const id = await enqueue(base, ["analyze"]);
    const html = await (await fetch(`${base}/jobs/${id}`)).text();
    expect(html).toContain("One must-fix.");
    expect(html).toContain("Medium.");
    expect(html).not.toContain("Seven files.");
    expect(html).not.toContain("It shows nothing about what the job IS");
  });

  test("an implement job shows 4-status.md", async () => {
    const { base, dir } = start();
    withFiles(dir);
    const id = await enqueue(base, ["implement"]);
    const html = await (await fetch(`${base}/jobs/${id}`)).text();
    expect(html).toContain("Workflow steps completed");
  });
});

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
