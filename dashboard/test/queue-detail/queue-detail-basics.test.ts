// `GET /api/queue/<id>`: one job as JSON, in the shape the list route uses.
// An id that names no job is a 404, never a blank answer.

import { describe, expect, test } from "bun:test";
import { detailHarness, enqueue } from "./queue-detail-fixtures.ts";

const { start } = detailHarness();

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
});
