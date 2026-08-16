// Criteria 1, 2, 6, 7 (spec 02): the per-job detail page and its JSON
// counterpart. `/queue` shows one row per JOB, so a three-step job shows
// one line and its finished steps are invisible; and the row says
// `02-job-detail-view` without saying what that spec is about.
//
// The two new routes are queue routes like every other: the token guard
// covers them, and an id that names no job is a 404, never a blank page.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ServerOptions } from "../src/serve.ts";

const TOKEN = "s3cret-token";
const failFetch = (async () => {
  throw new Error("down");
}) as unknown as typeof fetch;

const servers: { stop: () => void }[] = [];
const dirs: string[] = [];

const DESCRIPTION =
  "# A running job is a black box - Description\n\n" +
  "## Table of contents\n\n- [Description](#description)\n\n---\n\n" +
  "## Description\n\nThe queue shows state, step and cost. It shows nothing about " +
  "what the job IS, and nothing about what it is doing.\n\n---\n\n" +
  "## Related documents\n\n- [2-analysis.md](./2-analysis.md)\n";

function start(extra: Partial<ServerOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "aide-queue-detail-"));
  dirs.push(dir);
  writeFileSync(join(dir, "index.html"), "<p>overview</p>");
  const root = join(dir, "root");
  const proj = join(root, "aide");
  mkdirSync(join(proj, ".aide"), { recursive: true });
  writeFileSync(join(proj, ".aide", "project.yaml"), "name: aide\n");
  mkdirSync(join(proj, "specs", "81-queue-and-runner"), { recursive: true });
  writeFileSync(join(proj, "specs", "81-queue-and-runner", "1-description.md"), DESCRIPTION);
  const server = createServer({
    siteDir: dir,
    port: 0,
    claudeUsageFetch: failFetch,
    mirrorPath: join(dir, "runs.json"),
    queueMirrorPath: join(dir, "queue.json"),
    projectRoot: root,
    queueProjects: ["aide"],
    queueToken: TOKEN,
    ...extra,
  });
  servers.push(server);
  return { base: `http://127.0.0.1:${server.port}`, dir };
}

afterEach(() => {
  while (servers.length) servers.pop()!.stop();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const auth = { headers: { "x-aide-token": TOKEN } };

async function enqueue(base: string, steps: string[] = ["analyze"]): Promise<string> {
  const res = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
    body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps }),
  });
  const body = (await res.json()) as { job: { id: string } };
  return body.job.id;
}

describe("GET /queue/<id>", () => {
  test("shows what the job IS: its spec's title and description (criterion 1)", async () => {
    const { base } = start();
    const id = await enqueue(base);
    const res = await fetch(`${base}/queue/${id}`, auth);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("A running job is a black box");
    expect(html).toContain("It shows nothing about what the job IS");
    expect(html).toContain("81-queue-and-runner");
  });

  test("an unknown id is a 404, not an empty page (criterion 6)", async () => {
    const { base } = start();
    const res = await fetch(`${base}/queue/no-such-job`, auth);
    expect(res.status).toBe(404);
  });

  test("without the token it is refused exactly like every other queue path (criterion 7)", async () => {
    const { base } = start();
    const id = await enqueue(base);
    for (const path of [`/queue/${id}`, `/api/queue/${id}`, "/queue/no-such-job"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(401);
    }
  });

  test("with no token configured at all the whole surface is 503, these routes included", async () => {
    const { base } = start({ queueToken: undefined });
    for (const path of ["/queue/abc", "/api/queue/abc"]) {
      expect((await fetch(`${base}${path}`)).status).toBe(503);
    }
  });
});

describe("GET /api/queue/<id>", () => {
  test("returns the one job, in the same shape the list route uses", async () => {
    const { base } = start();
    const id = await enqueue(base);
    const res = await fetch(`${base}/api/queue/${id}`, auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { id: string; specFolder: string; results: unknown[] } };
    expect(body.job.id).toBe(id);
    expect(body.job.specFolder).toBe("81-queue-and-runner");
    expect(body.job.results).toEqual([]);
  });

  test("an unknown id is a 404 (criterion 6)", async () => {
    const { base } = start();
    const res = await fetch(`${base}/api/queue/no-such-job`, auth);
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toHaveProperty("error");
  });

  test("approve and cancel still work — the new route does not swallow them", async () => {
    const { base } = start();
    const id = await enqueue(base);
    const res = await fetch(`${base}/api/queue/${id}/cancel`, {
      method: "POST",
      headers: { "x-aide-token": TOKEN, accept: "application/json" },
    });
    expect(res.status).toBe(200);
    const after = (await (await fetch(`${base}/api/queue/${id}`, auth)).json()) as {
      job: { state: string };
    };
    expect(after.job.state).toBe("cancelled");
  });
});

describe("the finished steps a job table cannot show (criterion 2)", () => {
  test("every entry in results[] gets its own row", async () => {
    const { base, dir } = start();
    const id = await enqueue(base, ["analyze", "review-plan", "implement"]);
    // Reach into the mirror the way a completed step would have: the
    // route's job here is to SHOW the history, not to produce it.
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(await Bun.file(mirror).text()) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === id)!;
    job.stepIndex = 2;
    job.results = [
      { step: "analyze", ok: true, costUsd: 0.42, costMeasured: true, terminalReason: "completed", at: "2026-08-16T10:01:00Z" },
      { step: "review-plan", ok: true, costUsd: 1.07, costMeasured: true, terminalReason: "completed", at: "2026-08-16T10:03:00Z" },
    ];
    writeFileSync(mirror, JSON.stringify(jobs));

    // A fresh server reloads the mirror.
    const { base: base2 } = start({ queueMirrorPath: mirror });
    const html = await (await fetch(`${base2}/queue/${id}`, auth)).text();
    expect(html).toContain("analyze");
    expect(html).toContain("review-plan");
    expect(html).toContain("$0.42");
    expect(html).toContain("$1.07");
  });
});
