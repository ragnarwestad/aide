// Split out of queue-detail.test.ts by theme.
//
// Criteria 1, 2, 6, 7 (spec 02): the per-job detail page and its JSON
// counterpart. The list shows one row per JOB, so a three-step job shows
// one line and its finished steps are invisible; and the row says
// `02-job-detail-view` without saying what that spec is about.
//
// The two new routes are queue routes like every other: the token guard
// covers them, and an id that names no job is a 404, never a blank page.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerOptions } from "../src/serve/serve.ts";
import { queueHarness } from "./helpers/queue-server.ts";

const TOKEN = "s3cret-token";

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
  harness.start({ description: DESCRIPTION, extra: { queueToken: TOKEN, ...extra } });

afterEach(() => harness.cleanup());

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

describe("GET /specs/<id>", () => {
  // Spec 150: the `## Description` prose left this page for the spec
  // page, where the whole file is one of four. The title stays — a
  // reader still has to know which spec the job is about — and the
  // phase's own file takes the prose's place.
  test("shows what the job IS: its spec's title and its phase's file (criterion 1)", async () => {
    const { base, dir } = start();
    writeFileSync(
      join(dir, "root", "aide", "specs", "81-queue-and-runner", "3-solution.md"),
      "# Q - Solution\n\n## Steps\n\nSeven files, one route.\n",
    );
    const id = await enqueue(base);
    const res = await fetch(`${base}/specs/${id}`, auth);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("A running job is a black box");
    expect(html).toContain("Seven files, one route.");
    expect(html).toContain("81-queue-and-runner");
  });

  test("an unknown id is a 404, not an empty page (criterion 6)", async () => {
    const { base } = start();
    const res = await fetch(`${base}/specs/no-such-job`, auth);
    expect(res.status).toBe(404);
  });

  test("without the token it is refused exactly like every other queue path (criterion 7)", async () => {
    const { base } = start();
    const id = await enqueue(base);
    for (const path of [`/specs/${id}`, `/api/queue/${id}`, "/specs/no-such-job"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(401);
    }
  });

  test("with no token configured at all the whole surface is 503, these routes included", async () => {
    const { base } = start({ queueToken: undefined });
    for (const path of ["/specs/abc", "/api/queue/abc"]) {
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
    const id = await enqueue(base, ["analyze", "implement", "archive"]);
    // Reach into the mirror the way a completed step would have: the
    // route's job here is to SHOW the history, not to produce it.
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(await Bun.file(mirror).text()) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === id)!;
    job.stepIndex = 2;
    job.results = [
      { step: "analyze", ok: true, costUsd: 0.42, costMeasured: true, terminalReason: "completed", at: "2026-08-16T10:01:00Z" },
      { step: "implement", ok: true, costUsd: 1.07, costMeasured: true, terminalReason: "completed", at: "2026-08-16T10:03:00Z" },
    ];
    writeFileSync(mirror, JSON.stringify(jobs));

    // A fresh server reloads the mirror.
    const { base: base2 } = start({ queueMirrorPath: mirror });
    const html = await (await fetch(`${base2}/specs/${id}?tab=steps`, auth)).text();
    expect(html).toContain("analyze");
    expect(html).toContain("implement");
    expect(html).toContain("$0.42");
    expect(html).toContain("$1.07");
  });

  // The tab is a link, so the route has to honour it — a page that
  // ignored `?tab=` would always show the overview and the tabs would
  // be decoration.
  test("the route opens the tab the link asked for", async () => {
    const { base } = start();
    const id = await enqueue(base, ["analyze"]);
    const html = await (await fetch(`${base}/specs/${id}?tab=steps`, auth)).text();
    expect(html).toMatch(/aria-current="page"[^>]*>Logs/);
    expect(html).toContain("No step has finished yet");
  });
});

// --- spec 177: a job already carrying more steps than settings --------------
//
// The literal shape spec 176's own job was found in: started with two
// steps, ticked up to four while it ran (spec 160), and its three
// per-step tables still naming only the two it was created with. The
// page reads those tables for whichever step is current, so a job in
// this state shows a model it is not running on and a limit that is
// not a number.
describe("the page resolves a step its job's tables never named", () => {
  test("the model and the limit shown are the live config's, not blank", async () => {
    const { base, dir } = start();
    const id = await enqueue(base, ["analyze"]);
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === id)!;
    // Ticked on afterwards: `job.steps` grows, the settings tables do not.
    job.steps = ["analyze", "implement"];
    job.stepIndex = 1;
    job.state = "stopped";
    job.stopReason = "timeout";
    writeFileSync(mirror, JSON.stringify(jobs));

    const { base: base2 } = start({ queueMirrorPath: mirror });
    const html = await (await fetch(`${base2}/specs/${id}`, auth)).text();
    // `implement`'s own configured model and its own 90-minute limit —
    // not "as configured" and not "NaN min".
    expect(html).toContain("opus");
    expect(html).toContain("stopped — 90 min");
  });
});
