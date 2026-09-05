import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOKEN, JOB, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

test("a form POST answers 303 to /; a JSON caller gets JSON", async () => {
  const { base } = start({ queueToken: TOKEN });
  const form = await fetch(`${base}/api/queue`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
    body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "analyze" }),
  });
  expect(form.status).toBe(303);
  expect(form.headers.get("location")).toBe("/");

  const json = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
    // A different step: the same one is refused while the first is
    // unfinished, which is a separate rule with its own tests.
    body: JSON.stringify({ ...JOB, steps: ["implement"] }),
  });
  expect(json.status).toBe(200);
  const listed = (await (await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } })).json()) as {
    jobs: { project: string }[];
  };
  expect(listed.jobs.length).toBe(2);
});

test("an unknown project is 400 and stores nothing; an oversize body is 413", async () => {
  const { base } = start({ queueToken: TOKEN });
  const bad = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
    body: JSON.stringify({ ...JOB, project: "claude-usage" }),
  });
  expect(bad.status).toBe(400);
  const big = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
    body: JSON.stringify({ ...JOB, pad: "x".repeat(5000) }),
  });
  expect(big.status).toBe(413);
  const listed = (await (await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } })).json()) as {
    jobs: unknown[];
  };
  expect(listed.jobs).toEqual([]);
});

test("cancel marks the job cancelled", async () => {
  const { base } = start({ queueToken: TOKEN });
  const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const made = (await (
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) })
  ).json()) as { job: { id: string } };
  const id = made.job.id;
  expect((await fetch(`${base}/api/queue/${id}/cancel`, { method: "POST", headers })).status).toBe(200);
  const after = (await (await fetch(`${base}/api/queue`, { headers })).json()) as {
    jobs: { id: string; state: string }[];
  };
  expect(after.jobs.find((j) => j.id === id)?.state).toBe("cancelled");
  expect((await fetch(`${base}/api/queue/nope/cancel`, { method: "POST", headers })).status).toBe(404);
});

// Only a job that still owns its work can be cancelled. A finished
// job's state is history — done, failed, stopped — and Cancel must not
// rewrite it to "cancelled" as though someone had ended the run.
test("cancel refuses a job that has already finished, and leaves its state alone", async () => {
  const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  for (const state of ["done", "failed", "stopped", "cancelled", "interrupted"]) {
    const site = mkdtempSync(join(tmpdir(), "aide-cancel-finished-"));
    ownDirs.push(site);
    const id = `fin-${state}`;
    writeFileSync(join(site, "queue.json"), JSON.stringify([{
      id, project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"], stepIndex: 0, state,
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: { default: 1200 }, permissionMode: {}, model: {},
      createdAt: "2026-08-17T00:00:00Z", finishedAt: "2026-08-17T00:10:00Z",
    }]));
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: join(site, "queue.json") });
    const res = await fetch(`${base}/api/queue/${id}/cancel`, { method: "POST", headers });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain(state);
    const after = (await (await fetch(`${base}/api/queue`, { headers })).json()) as {
      jobs: { id: string; state: string }[];
    };
    expect(after.jobs.find((j) => j.id === id)?.state).toBe(state);
    harness.cleanup();
  }
});
