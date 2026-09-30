// Every action the board's pages post answers in the one form the page
// script reads: JSON, `ok` on success and `error` with a 4xx on a
// refusal, whatever the request's Accept header says. Each press is a
// form body posted the way a browser posts one, with no Accept header.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupQueueRoutesHarness } from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-actions-json-");
const dirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const SPEC = "81-queue-and-runner";

/** A form post, as a browser sends one from a page without the script. */
const press = (base: string, path: string, fields: [string, string][] = []) =>
  fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });

/** A job for the presses that need one, queued as the page script queues it. */
async function queued(base: string): Promise<string> {
  const res = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["analyze"] }),
  });
  return ((await res.json()) as { job: { id: string } }).job.id;
}

/** JSON, and never a redirect. A refusal names why: once, or step by
 *  step for the project routes (`results`). */
async function expectJson(res: Response): Promise<void> {
  expect(res.status < 300 || res.status >= 400).toBe(true);
  expect(res.headers.get("location")).toBeNull();
  expect(res.headers.get("content-type") ?? "").toContain("application/json");
  const body = (await res.json()) as { ok?: boolean; error?: string; results?: { error?: string }[] };
  if (res.status < 400) expect(body.ok).toBe(true);
  else expect(body.error ?? body.results?.find((r) => r.error)?.error).toEqual(expect.any(String));
}

/** Each action family, with a body that reaches its answer: a refusal
 *  where a refusal is cheap to reach, a success where it is not. */
const PRESSES: { name: string; path: (job: string) => string; fields?: [string, string][] }[] = [
  { name: "create", path: () => "/api/queue/create", fields: [["project", "nope"], ["title", "x"]] },
  { name: "run", path: () => "/api/queue", fields: [["project", "aide"], ["specFolder", "no-such-spec"], ["steps", "analyze"]] },
  { name: "cancel", path: (job) => `/api/queue/${job}/cancel` },
  { name: "a running job's steps", path: (job) => `/api/queue/${job}/steps`, fields: [["step", "bogus"], ["checked", "1"]] },
  { name: "a running job's model", path: (job) => `/api/queue/${job}/model`, fields: [["step", "bogus"], ["model", "x"]] },
  { name: "a spec's model", path: () => `/api/queue/specs/aide/${SPEC}/model`, fields: [["step", "bogus"], ["model", "x"]] },
  { name: "close", path: () => `/api/queue/specs/aide/${SPEC}/close`, fields: [["reason", ""]] },
  { name: "delete branch", path: () => `/api/queue/specs/aide/${SPEC}/delete-branch` },
  { name: "a spec's test server start", path: () => `/api/queue/specs/aide/${SPEC}/test-server` },
  { name: "a spec's test server stop", path: () => `/api/queue/specs/aide/${SPEC}/test-server/stop` },
  { name: "tick", path: () => `/api/queue/specs/aide/${SPEC}/tick` },
  { name: "tracking", path: () => `/api/queue/specs/aide/${SPEC}/tracking`, fields: [["dependsOn", "999"]] },
  { name: "save", path: () => `/api/queue/specs/aide/${SPEC}/save`, fields: [["file", "4-status.md"], ["text", "x"]] },
  { name: "update", path: () => `/api/queue/specs/aide/${SPEC}/update` },
  { name: "settings", path: () => "/api/queue/settings" },
  { name: "check", path: () => "/api/queue/settings/check", fields: [["tool", "bogus"]] },
  { name: "concurrency", path: () => "/api/queue/settings/concurrency", fields: [["concurrency", "2"]] },
  { name: "add project", path: () => "/api/queue/projects", fields: [["name", ""]] },
  { name: "project settings", path: () => "/api/queue/projects/nope/settings", fields: [["specsPath", "x"]] },
  { name: "remove project", path: () => "/api/queue/projects/nope/remove" },
  { name: "a project's test server stop", path: () => "/api/queue/projects/aide/test-server/stop" },
  { name: "build wiki", path: () => "/api/queue/projects/aide/wiki" },
  { name: "schedule create", path: () => "/api/queue/schedule", fields: [["project", "aide"], ["name", ""], ["cron", "x"]] },
  { name: "schedule edit", path: () => "/api/queue/schedule/aide/nightly", fields: [["name", ""], ["cron", "x"]] },
  { name: "schedule enabled", path: () => "/api/queue/schedule/aide/nightly/enabled", fields: [["enabled", "1"]] },
  { name: "schedule run", path: () => "/api/queue/schedule/aide/nightly/run" },
  { name: "schedule delete", path: () => "/api/queue/schedule/aide/nightly/delete" },
];

describe("every action answers JSON, never a redirect", () => {
  for (const p of PRESSES) {
    test(`${p.name} answers JSON to a form posted without Accept (AC-1)`, async () => {
      const { base } = start();
      const job = await queued(base);
      await expectJson(await press(base, p.path(job), p.fields));
    });
  }

  test("dismissing a failed create answers JSON to a form posted without Accept (AC-1)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-actions-json-failed-"));
    dirs.push(dir);
    const failedCreatesPath = join(dir, "failed-creates.json");
    writeFileSync(failedCreatesPath, JSON.stringify([{
      id: "first", project: "aide", title: "T", description: "D",
      reason: { key: "runner.serverRestarted", values: { button: "Create" } }, failedAt: "2026-09-19T17:01:00.000Z",
    }]));
    const { base } = start({ failedCreatesPath });
    await expectJson(await press(base, "/api/queue/failed-creates/first/dismiss"));
  });

  test("a refused Update answers its reason as JSON (AC-1)", async () => {
    const { base } = start();
    const res = await press(base, `/api/queue/specs/aide/${SPEC}/update`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
  });
});
