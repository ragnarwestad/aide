// POST /api/queue/<id>/dismiss takes a failed scheduled job's row off the
// Running tab and leaves the job. Which jobs may be dismissed is proven where
// the rule lives (`rows.test.ts`); this proves the route is wired to it and
// that the Running tab reads what it stores.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupQueueRoutesHarness } from "../../fixtures.ts";

const { harness } = setupQueueRoutesHarness();
const tmp: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (tmp.length) rmSync(tmp.pop()!, { recursive: true, force: true });
});

const headers = { "content-type": "application/json", accept: "application/json" };

const job = (o: Record<string, unknown>) => ({
  id: "j1",
  project: "aide",
  specFolder: "schedule-nightly",
  steps: ["schedule"],
  stepIndex: 0,
  state: "failed",
  timeoutSec: {},
  permissionMode: {},
  model: {},
  results: [{ step: "schedule", ok: false, exitCode: 1, costUsd: 0.1, costMeasured: true, terminalReason: "error", repos: [] }],
  createdAt: "2026-10-08T10:00:00Z",
  startedAt: "2026-10-08T10:01:00Z",
  finishedAt: "2026-10-08T10:05:00Z",
  ...o,
});

/** A queue config whose schedule holds `nightly` for aide, so a waiting job of it keeps its row. */
function scheduleConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-dismiss-schedule-"));
  tmp.push(dir);
  const file = join(dir, "queue-config.json");
  writeFileSync(file, JSON.stringify({ schedules: { aide: [{ name: "nightly", cron: "0 3 * * *", prompt: "docs/n.md", enabled: false }] } }));
  return file;
}

const board = (jobs: Record<string, unknown>[]) =>
  harness.start({ extra: { queueProjects: ["aide"], queueConfigFile: scheduleConfig() }, queueMirror: JSON.stringify(jobs) });

const dismiss = (base: string, id: string, method = "POST") => fetch(`${base}/api/queue/${id}/dismiss`, { method, headers });
const rows = async (base: string): Promise<string> => await (await fetch(`${base}/?rows=1`)).text();
const hasRow = (html: string): boolean => html.includes('id="spec-aide/schedule-nightly"');
const stored = async (base: string, id: string) =>
  ((await (await fetch(`${base}/api/queue/${id}`, { headers })).json()) as { job: Record<string, unknown> }).job;

describe("dismissing a failed scheduled job", () => {
  test("keeps the job, its results and its page, and takes the row off the tab (AC-2, AC-3)", async () => {
    const { base } = board([job({})]);
    expect(hasRow(await rows(base))).toBe(true);

    const res = await dismiss(base, "j1");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);

    const after = await stored(base, "j1");
    expect(after.state).toBe("failed");
    expect(after.results).toHaveLength(1);
    expect(typeof after.dismissedAt).toBe("string");
    expect((await fetch(`${base}/jobs/j1`)).status).toBe(200);
    expect(hasRow(await rows(base))).toBe(false);
  });

  test("a job mirrored with a dismissal later than its finish has no row after a start (AC-3)", async () => {
    const { base } = board([job({ dismissedAt: "2026-10-08T11:00:00Z" })]);
    expect(hasRow(await rows(base))).toBe(false);
    expect((await stored(base, "j1")).state).toBe("failed");
  });

  test("a row that came back after the job ended again can be dismissed again (AC-2, AC-3)", async () => {
    const { base } = board([job({ dismissedAt: "2026-10-08T10:03:00Z" })]);
    expect(hasRow(await rows(base))).toBe(true);

    expect((await dismiss(base, "j1")).status).toBe(200);
    expect(hasRow(await rows(base))).toBe(false);
  });
});

describe("the dismiss route refuses what the row does not offer it for", () => {
  test("a failed spec job is refused with 409 and left unchanged (AC-4)", async () => {
    const { base } = board([job({ id: "sp", specFolder: "81-queue", steps: ["analyze"] })]);
    const res = await dismiss(base, "sp");
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; spec: string };
    expect(body.error).not.toBe("");
    expect(body.spec).toBe("aide/81-queue");

    const after = await stored(base, "sp");
    expect(after.state).toBe("failed");
    expect(after).not.toHaveProperty("dismissedAt");
  });

  test("an unknown job answers 404, and a GET answers 405 (AC-4)", async () => {
    const { base } = board([job({})]);
    const unknown = await dismiss(base, "nope");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "no such job" });
    expect((await dismiss(base, "j1", "GET")).status).toBe(405);
    expect(hasRow(await rows(base))).toBe(true);
  });
});
