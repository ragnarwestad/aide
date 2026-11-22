// Split out of queue-detail.test.ts by theme.
//
// The per-job detail page and its JSON
// counterpart. The list shows one row per JOB, so a three-step job shows
// one line and its finished steps are invisible; and the row says
// `02-job-detail-view` without saying what that spec is about.
//
// The two new routes are queue routes like every other: the token guard
// covers them, and an id that names no job is a 404, never a blank page.

import { afterEach, describe, expect, test } from "bun:test";
import type { ServerOptions } from "../../src/serve/serve.ts";
import { queueHarness } from "../helpers/queue-server.ts";

const DESCRIPTION =
  "# A running job is a black box - Description\n\n" +
  "## Table of contents\n\n- [Description](#description)\n\n---\n\n" +
  "## Description\n\nThe queue shows state, step and cost. It shows nothing about " +
  "what the job IS, and nothing about what it is doing.\n\n---\n\n" +
  "## Related documents\n\n- [2-analysis.md](./2-analysis.md)\n";

const harness = queueHarness("aide-queue-detail-");

// Every test here is behind the token, so it is part of the fixture
// rather than something each call has to remember.
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

describe("a job has no page of its own", () => {
  test("its address, and the two it had before, answer 404", async () => {
    const { base } = start();
    const id = await enqueue(base);
    for (const path of [`/jobs/${id}`, `/queue/${id}`, `/specs/${id}`]) {
      expect((await fetch(`${base}${path}`, { redirect: "manual" })).status).toBe(404);
    }
  });
});

describe("GET /api/queue/<id>", () => {
  test("returns the one job, in the same shape the list route uses", async () => {
    const { base } = start();
    const id = await enqueue(base);
    const res = await fetch(`${base}/api/queue/${id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { id: string; specFolder: string; results: unknown[] } };
    expect(body.job.id).toBe(id);
    expect(body.job.specFolder).toBe("81-queue-and-runner");
    expect(body.job.results).toEqual([]);
  });

  test("an unknown id is a 404", async () => {
    const { base } = start();
    const res = await fetch(`${base}/api/queue/no-such-job`);
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toHaveProperty("error");
  });

  test("approve and cancel still work — the new route does not swallow them", async () => {
    const { base } = start();
    const id = await enqueue(base);
    const res = await fetch(`${base}/api/queue/${id}/cancel`, {
      method: "POST",
      headers: { accept: "application/json" },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { job: { state: string } }).job.state).toBe("cancelled");
  });
});

describe("the finished steps a job table cannot show", () => {

});
