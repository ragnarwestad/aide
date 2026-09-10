// Split out of queue-detail.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerOptions } from "../../src/serve/serve.ts";
import type { QueueDefaults } from "../../src/queue/queue.ts";
import { queueHarness } from "../helpers/queue-server.ts";

const TOKEN = "s3cret-token";

const DESCRIPTION =
  "# A running job is a black box - Description\n\n" +
  "## Table of contents\n\n- [Description](#description)\n\n---\n\n" +
  "## Description\n\nThe queue shows state, step and cost. It shows nothing about " +
  "what the job IS, and nothing about what it is doing.\n\n---\n\n" +
  "## Related documents\n\n- [2-analysis.md](./2-analysis.md)\n";

const harness = queueHarness("aide-queue-detail-");

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

// --- spec 125: the page has to know which CLI ran the step -------------------
//
// Two things on this page turn on it, and both are wrong-by-default if
// nobody works it out: the Live panel would be built from a session
// `claude-usage` has never heard of, and the transcript would be read in
// the wrong schema — which does not degrade, it blanks the list.
describe("a Codex step's job page", () => {
  /** Seed a job the way a finished step leaves it, and hand back a
   *  mirror a second server can read. */
  const seed = (dir: string, id: string, mutate: (job: Record<string, unknown>) => void): string => {
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    mutate(jobs.find((j) => j.id === id)!);
    writeFileSync(mirror, JSON.stringify(jobs));
    return mirror;
  };

  /** The one config difference these tests need: a pickable entry that
   *  names Codex. Everything else is the server's own defaults. */
  const CODEX_CHOICE: QueueDefaults = {
    budgetUsd: 3,
    jobCapUsd: 10,
    dailyCapUsd: 20,
    timeoutSec: { default: 1200 },
    permissionMode: { default: "acceptEdits" },
    model: { default: "sonnet" },
    modelChoices: { "codex-fast": { budgetUsd: 5, tool: "codex" } },
  };

  const CODEX_STREAM = [
    JSON.stringify({ type: "thread.started", thread_id: "0199f4c2" }),
    JSON.stringify({
      type: "item.completed",
      item: { id: "i0", item_type: "command_execution", command: "bun test" },
    }),
  ].join("\n");

  test("a finished Codex step reads its own transcript and shows no dollars", async () => {
    const { base, dir } = start();
    const id = await enqueue(base, ["implement"]);
    const stream = join(dir, "codex.stream.jsonl");
    writeFileSync(stream, CODEX_STREAM);
    const mirror = seed(dir, id, (job) => {
      job.state = "done";
      job.results = [
        {
          step: "implement", ok: true, tool: "codex", costUsd: 0, costMeasured: false,
          tokens: { input: 1, output: 2, cacheRead: 3, cacheCreation: 0, total: 6 },
          terminalReason: "completed", streamFile: stream, at: "2026-08-20T10:01:00Z",
        },
      ];
    });

    const { base: base2 } = start({ queueMirrorPath: mirror });
    const activity = await (await fetch(`${base2}/specs/${id}?tab=steps&step=0`, auth)).text();
    expect(activity).toContain("bun test");
    const steps = await (await fetch(`${base2}/specs/${id}?tab=steps`, auth)).text();
    expect(steps).not.toContain("$0.00");
  });

  test("a RUNNING Codex step is recognised from the config, before any result exists", async () => {
    // The result file that would carry `tool` is written when the step
    // ENDS, so a running step has to be resolved from the entry its
    // chosen model name points at — the same lookup that built the argv.
    const { base, dir } = start({
      queueDefaults: CODEX_CHOICE,
    });
    const id = await enqueue(base, ["implement"]);
    const mirror = seed(dir, id, (job) => {
      job.state = "running";
      job.sessionId = "0199f4c2-6d1a-7c31-9f0e-2b7a5c8d1e44";
      job.model = { implement: "codex-fast" };
    });

    const { base: base2 } = start({
      queueMirrorPath: mirror,
      queueDefaults: CODEX_CHOICE,
    });
    const html = await (await fetch(`${base2}/specs/${id}`, auth)).text();
    expect(html).not.toContain("Live right now");
  });

  test("a transcript nobody named a tool for is still read, not blanked", async () => {
    // A config entry removed since the job started, or a job older than
    // the field: defaulting to claude here would be a claim, and a wrong
    // one leaves the reader an empty list that says "doing nothing".
    const { base, dir } = start();
    const id = await enqueue(base, ["implement"]);
    const stream = join(dir, "orphan.stream.jsonl");
    writeFileSync(stream, CODEX_STREAM);
    const mirror = seed(dir, id, (job) => {
      job.state = "done";
      job.results = [
        {
          step: "implement", ok: true, costUsd: 0, costMeasured: false,
          terminalReason: "completed", streamFile: stream, at: "2026-08-20T10:01:00Z",
        },
      ];
    });

    const { base: base2 } = start({ queueMirrorPath: mirror });
    const html = await (await fetch(`${base2}/specs/${id}?tab=steps&step=0`, auth)).text();
    expect(html).toContain("bun test");
  });
});

// --- spec 408: the job detail page threads and remembers the language -------
//
// `job-detail.ts` already resolved `languageChoice()` for spec 350's own
// `lang` field, but never appended its `setCookie` to the response, and
// never forwarded that `lang` into its own `pageShell` call — so the
// page's own frame (the tab bar, the theme control) stayed English and
// the choice was never written down from this route.

describe("GET /specs/<id> remembers the reader's language (spec 408)", () => {
  test("?lang=nb sets the cookie and renders a Norwegian frame", async () => {
    const { base } = start();
    const id = await enqueue(base);
    const res = await fetch(`${base}/specs/${id}?lang=nb`, auth);
    expect(res.headers.getSetCookie().find((c) => c.startsWith("aide_lang=nb"))).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('<html lang="nb">');
  });
});

// --- spec 150: a page for the SPEC, not for one of its runs ------------------
//
// `/specs/<job-id>` is one queue run. `/specs/<project>/<specFolder>` is
// the spec itself: the four files as they stand on this host's checkout,
// each stamped with its own last commit, plus an Update button that
// pulls the specs repository so a change pushed a moment ago is on the
// screen at once.

describe("GET /specs/<project>/<specFolder>", () => {
  const SPEC = "81-queue-and-runner";
  const PATH = `/specs/aide/${SPEC}`;

  /** The three files the harness does not write. */
  const fillSpec = (dir: string): void => {
    const spec = join(dir, "root", "aide", "specs", SPEC);
    writeFileSync(join(spec, "2-analysis.md"), "# Q - Analysis\n\n## Findings\n\nSeven files.\n");
    writeFileSync(
      join(spec, "3-solution.md"),
      "# Q - Solution\n\n## Plan review\n\nOne must-fix.\n\n## Risk analysis\n\nMedium.\n",
    );
  };

  // Spec 212: all four are still there, one TAB each, rather than
  // stacked in full on Overview. Overview itself carries no file text —
  // it is where the spec stands.
  test("offers all four files, whether or not anything has ever run (criterion 2)", async () => {
    const { base, dir } = start();
    fillSpec(dir);
    const res = await fetch(`${base}${PATH}`, auth);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const overview = await res.text();
    for (const tab of ["description", "analysis", "solution", "status"]) {
      expect([tab, overview.includes(`?tab=${tab}`)]).toEqual([tab, true]);
    }
    expect(overview).not.toContain("Seven files.");

    const analysis = await (await fetch(`${base}${PATH}?tab=analysis`, auth)).text();
    expect(analysis).toContain("2-analysis.md");
    expect(analysis).toContain("Seven files.");
    const solution = await (await fetch(`${base}${PATH}?tab=solution`, auth)).text();
    expect(solution).toContain("3-solution.md");
    expect(solution).toContain("One must-fix.");
  });

  test("with a lead job it shows that job's Activity and Steps (criterion 1)", async () => {
    const { base, dir } = start();
    fillSpec(dir);
    const id = await enqueue(base);
    expect(id).toBeTruthy();
    const html = await (await fetch(`${base}${PATH}?tab=steps`, auth)).text();
    expect(html).toContain("No step has finished yet");
    expect(html).toContain(`href="${PATH}?tab=checks"`);
  });

  test("a spec nobody has is a 404, not a blank page", async () => {
    const { base } = start();
    expect((await fetch(`${base}/specs/aide/99-no-such-spec`, auth)).status).toBe(404);
    expect((await fetch(`${base}/specs/no-such-project/${SPEC}`, auth)).status).toBe(404);
  });

  // The two routes are one path segment apart and must stay disjoint:
  // a job id has no slash in it, and a spec page has no job.
  test("the job route still answers, and neither swallows the other", async () => {
    const { base } = start();
    const id = await enqueue(base);
    expect((await fetch(`${base}/specs/${id}`, auth)).status).toBe(200);
    expect((await fetch(`${base}${PATH}`, auth)).status).toBe(200);
    // The job page is about the run; the spec page is about the spec.
    // An analyze job's page carries 3-solution.md, its own phase's
    // file, and none of the other three the spec page lists.
    const job = await (await fetch(`${base}/specs/${id}`, auth)).text();
    expect(job).not.toContain("1-description.md");
  });

  test("it is behind the token like every other queue path", async () => {
    const { base } = start();
    expect((await fetch(`${base}${PATH}`)).status).toBe(401);
    const { base: off } = start({ queueToken: undefined });
    expect((await fetch(`${off}${PATH}`)).status).toBe(503);
  });

  // Spec 408, REQ-1/REQ-4: this route reads and remembers the language
  // the same way `/` already does.
  test("?lang=nb sets the cookie and renders a Norwegian frame", async () => {
    const { base } = start();
    const res = await fetch(`${base}${PATH}?lang=nb`, auth);
    expect(res.headers.getSetCookie().find((c) => c.startsWith("aide_lang=nb"))).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('<html lang="nb">');
  });

  test("the spec's files are re-read on every request, never served from the 5 s scan", async () => {
    const { base, dir } = start();
    const spec = join(dir, "root", "aide", "specs", SPEC);
    const analysis = `${PATH}?tab=analysis`;
    // Distinctive sentinels, not English words: the stylesheet is
    // inlined into every page, and a comment in it saying "before"
    // failed this test for a week's worth of head-scratching
    // (2026-08-24) while the files were being re-read just fine.
    writeFileSync(join(spec, "2-analysis.md"), "sentinel-first-write\n");
    expect(await (await fetch(`${base}${analysis}`, auth)).text()).toContain("sentinel-first-write");
    writeFileSync(join(spec, "2-analysis.md"), "sentinel-second-write\n");
    const html = await (await fetch(`${base}${analysis}`, auth)).text();
    expect(html).toContain("sentinel-second-write");
    expect(html).not.toContain("sentinel-first-write");
  });
});

// --- spec 242: every attempt's steps in one flat list, no picker ------------
//
// The picker used to read `?job=` to decide which attempt's steps to
// show. Direction: remove the picker, list every attempt's steps
// together, and stop reading `?job=` at all — a stray one on an old
// bookmark or shared link now changes nothing rather than filtering.

describe("GET /specs/<project>/<specFolder>?job=", () => {
  const SPEC = "81-queue-and-runner";
  const PATH = `/specs/aide/${SPEC}`;

  // Spec 435: the header's language links now target the request's own
  // full address, `job=` included — so two responses that differ only
  // in a harmless `job=` legitimately differ there now. That is not
  // what AC6 tests: strip the one block that is SUPPOSED to vary before
  // asserting the rest of the page is untouched.
  const withoutLangMenu = (html: string): string =>
    html.replace(/<details class="menu lang">[\s\S]*?<\/details>/, "");

  /** Two finished analyze jobs on one spec, oldest last — which is one
   *  more than the queue will accept through its own route, so the
   *  second is written into the mirror the server reads at boot. */
  const twoAttempts = (dir: string, id: string): string => {
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const newer = jobs.find((j) => j.id === id)!;
    newer.state = "done";
    newer.startedAt = "2026-08-21T11:00:00Z";
    newer.results = [
      {
        step: "analyze", ok: true, costUsd: 7.77, costMeasured: true,
        terminalReason: "completed", at: "2026-08-21T11:30:00Z",
      },
    ];
    jobs.push({
      ...newer,
      id: "older-attempt",
      state: "failed",
      error: "unknown spec",
      startedAt: "2026-08-19T11:00:00Z",
      results: [
        {
          step: "analyze", ok: false, costUsd: 1.11, costMeasured: true,
          terminalReason: "completed", at: "2026-08-19T11:30:00Z",
        },
      ],
    });
    writeFileSync(mirror, JSON.stringify(jobs));
    return mirror;
  };

  test("?job= naming a real other attempt changes nothing (AC6)", async () => {
    const { base, dir } = start();
    const id = await enqueue(base);
    const mirror = twoAttempts(dir, id);

    const { base: base2 } = start({ queueMirrorPath: mirror });
    const bare = withoutLangMenu(await (await fetch(`${base2}${PATH}?tab=steps`, auth)).text());
    const res = await fetch(`${base2}${PATH}?tab=steps&job=older-attempt`, auth);
    expect(res.status).toBe(200);
    expect(withoutLangMenu(await res.text())).toBe(bare);
  });

  test("?job= naming no job at all changes nothing (AC6)", async () => {
    const { base, dir } = start();
    const id = await enqueue(base);
    const mirror = twoAttempts(dir, id);

    const { base: base2 } = start({ queueMirrorPath: mirror });
    const bare = withoutLangMenu(await (await fetch(`${base2}${PATH}?tab=steps`, auth)).text());
    const res = await fetch(`${base2}${PATH}?tab=steps&job=no-such-job`, auth);
    expect(res.status).toBe(200);
    expect(withoutLangMenu(await res.text())).toBe(bare);
  });

  // The candidate used to be looked for only among THIS spec's own
  // jobs, so a crafted id could not make one spec's page show another's
  // transcript. There is nothing left to select, so the point is now
  // moot the same way — the response is unaffected either way.
  test("?job= naming a job of a different spec changes nothing (AC6)", async () => {
    const { base, dir } = start();
    const id = await enqueue(base);
    const mirror = twoAttempts(dir, id);
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    jobs.push({
      ...jobs[0]!,
      id: "another-spec",
      specFolder: "90-somewhere-else",
      state: "done",
      startedAt: "2026-08-20T11:00:00Z",
      results: [
        {
          step: "analyze", ok: true, costUsd: 9.99, costMeasured: true,
          terminalReason: "completed", at: "2026-08-20T11:30:00Z",
        },
      ],
    });
    writeFileSync(mirror, JSON.stringify(jobs));

    const { base: base2 } = start({ queueMirrorPath: mirror });
    const bare = withoutLangMenu(await (await fetch(`${base2}${PATH}?tab=steps`, auth)).text());
    const res = await fetch(`${base2}${PATH}?tab=steps&job=another-spec`, auth);
    expect(res.status).toBe(200);
    expect(withoutLangMenu(await res.text())).toBe(bare);
  });

  test("both attempts' cost figures are present together in one response (AC7)", async () => {
    const { base, dir } = start();
    const id = await enqueue(base);
    const mirror = twoAttempts(dir, id);

    const { base: base2 } = start({ queueMirrorPath: mirror });
    const html = await (await fetch(`${base2}${PATH}?tab=steps`, auth)).text();
    expect(html).toContain("$7.77");
    expect(html).toContain("$1.11");
  });

  test("a spec with one job shows no Attempt marker (AC1, HTTP level)", async () => {
    const { base } = start();
    await enqueue(base);
    const html = await (await fetch(`${base}${PATH}?tab=steps`, auth)).text();
    expect(html).not.toContain("Attempt ");
    expect(html).not.toContain('data-filter="attempt"');
  });
});
