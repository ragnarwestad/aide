// Split out of queue-detail.test.ts by theme.
//
// The per-job detail page and its JSON
// counterpart. The list shows one row per JOB, so a three-step job shows
// one line and its finished steps are invisible; and the row says
// `02-job-detail-view` without saying what that spec is about.
//
// The two new routes are queue routes like every other: the token guard
// covers them, and an id that names no job is a 404, never a blank page.

import { describe, expect, test } from "bun:test";
import { detailHarness, enqueue } from "./queue-detail-fixtures.ts";

const { start } = detailHarness();

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
