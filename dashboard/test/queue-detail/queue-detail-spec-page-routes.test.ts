// Split out of queue-detail.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGitRunner, type GitRunner } from "../../src/git/branch-status.ts";
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
    const activity = await (await fetch(`${base2}/specs/${id}?tab=steps&step=0`)).text();
    expect(activity).toContain("bun test");
    const steps = await (await fetch(`${base2}/specs/${id}?tab=steps`)).text();
    expect(steps).not.toContain("$0.00");
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
    const html = await (await fetch(`${base2}/specs/${id}?tab=steps&step=0`)).text();
    expect(html).toContain("bun test");
  });

  // The step's tab is read from the address and carried to the renderer,
  // so a step keeps its tab when the page reloads itself.
  test("steptab= in the URL picks the step's tab, and a leftover only= changes nothing (AC-6, AC-7)", async () => {
    const { base, dir } = start();
    const id = await enqueue(base, ["implement"]);
    const stream = join(dir, "filtered.stream.jsonl");
    writeFileSync(stream, [
      JSON.stringify({ type: "thread.started", thread_id: "0199f4c2" }),
      JSON.stringify({ type: "item.completed", item: { id: "i0", item_type: "agent_message", text: "thinking it over" } }),
      JSON.stringify({ type: "item.completed", item: { id: "i1", item_type: "command_execution", command: "bun test", exit_code: 1 } }),
      JSON.stringify({ type: "item.completed", item: { id: "i2", item_type: "command_execution", command: "git status", exit_code: 0 } }),
    ].join("\n"));
    const mirror = seed(dir, id, (job) => {
      job.state = "done";
      job.results = [
        {
          step: "implement", ok: true, costUsd: 0, costMeasured: false,
          terminalReason: "completed", streamFile: stream, at: "2026-09-17T10:01:00Z",
        },
      ];
    });

    const { base: base2 } = start({ queueMirrorPath: mirror });
    const log = await (await fetch(`${base2}/specs/${id}?tab=steps&step=0`)).text();
    expect(log).toContain("thinking it over");

    const errors = await (await fetch(`${base2}/specs/${id}?tab=steps&step=0&steptab=errors`)).text();
    expect(errors).toContain("bun test");
    expect(errors).not.toContain("thinking it over");
    expect(errors).not.toContain("git status");

    const old = await (await fetch(`${base2}/specs/${id}?tab=steps&step=0&only=commands`)).text();
    expect(old).toContain("thinking it over");
    expect(old).toContain("git status");
  });

  test("steptab=files opens the step on Changed files, marked as the page's own tab bar marks its tab, on the spec page's Logs tab too (AC-2)", async () => {
    const { base, dir } = start();
    const id = await enqueue(base, ["implement"]);
    const mirror = seed(dir, id, (job) => {
      job.state = "done";
      job.results = [
        { step: "implement", ok: true, costUsd: 0, costMeasured: false, terminalReason: "completed", at: "2026-09-17T10:01:00Z" },
      ];
    });
    const { base: base2 } = start({ queueMirrorPath: mirror });
    const current = (html: string) => html.match(/<a class="tab"[^>]*href="[^"]*steptab=[^"]*"[^>]*aria-current="page"[^>]*>([^<]*)</)?.[1];

    const job = await (await fetch(`${base2}/jobs/${id}?tab=steps&step=0&steptab=files`)).text();
    expect(current(job)).toBe("Changed files");
    const spec = await (await fetch(`${base2}/specs/aide/81-queue-and-runner?tab=steps&step=0&steptab=files`)).text();
    expect(current(spec)).toBe("Changed files");
  });
});

// --- spec 408: the job detail page threads and remembers the language -------
//
// `job-detail.ts` already resolved `languageChoice()` for spec 350's own
// `lang` field, but never appended its `setCookie` to the response, and
// never forwarded that `lang` into its own `pageShell` call — so the
// page's own frame (the tab bar, the theme control) stayed English and
// the choice was never written down from this route.

// --- spec 150: a page for the SPEC, not for one of its runs ------------------
//
// `/jobs/<job-id>` is one queue run. `/specs/<project>/<specFolder>` is
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
    const res = await fetch(`${base}${PATH}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const overview = await res.text();
    for (const tab of ["description", "analysis", "solution", "status"]) {
      expect([tab, overview.includes(`?tab=${tab}`)]).toEqual([tab, true]);
    }
    expect(overview).not.toContain("Seven files.");

    const analysis = await (await fetch(`${base}${PATH}?tab=analysis`)).text();
    expect(analysis).toContain("2-analysis.md");
    expect(analysis).toContain("Seven files.");
    const solution = await (await fetch(`${base}${PATH}?tab=solution`)).text();
    expect(solution).toContain("3-solution.md");
    expect(solution).toContain("One must-fix.");
  });

  // Spec 627: the spec's address is the Specs list with that row open, and
  // the spec drawn in the row.
  test("answers the Specs list with the spec's row open and the whole spec in it (AC-1)", async () => {
    const { base, dir } = start();
    fillSpec(dir);
    const res = await fetch(`${base}${PATH}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="jobrows"');
    expect(html).toContain(`data-spec-detail="aide/${SPEC}"`);
    // The part above the tabs, once.
    expect(html.match(/class="trackingform/g)).toHaveLength(1);
    // The tabs, each a link to the spec's own address, and the Description panel.
    for (const tab of ["description", "analysis", "solution", "status", "steps"]) {
      expect([tab, new RegExp(`href="/specs/aide/${SPEC}\\?[^"]*tab=${tab}`).test(html)]).toEqual([tab, true]);
    }
    expect(html).toContain("It shows nothing about");
  });

  // `<select` is not checked here: the banner carries the create choices'
  // disabled criteria-checks select. The caption line is looked for as a
  // row, since the page's stylesheet names `data-caption` too.
  test("the open row is the spec alone: no phase line and no Run, and Close or Reopen at the end of its tabs (AC-1, AC-2)", async () => {
    const live = harness.start({ description: DESCRIPTION, archivedSpecs: { "70-an-old-spec": {} } });
    const open = await (await fetch(`${live.base}${PATH}`)).text();
    expect(open).toContain('data-ask="closeask"');
    for (const absent of ['class="subrow"', '<tr class="subrow" data-caption', 'class="rowrun"']) {
      expect([absent, open.includes(absent)]).toEqual([absent, false]);
    }
    const archived = await (await fetch(`${live.base}/specs/aide/70-an-old-spec`)).text();
    expect(archived).toContain('data-ask="reopenask"');
    expect(archived).not.toContain('data-ask="reopenask-aide/70-an-old-spec"');
  });

  test("a spec archived while the list shows only the active ones is still the open row (AC-4)", async () => {
    const { base } = harness.start({ description: DESCRIPTION, archivedSpecs: { "70-an-old-spec": {} } });
    const html = await (await fetch(`${base}/specs/aide/70-an-old-spec`)).text();
    expect(html).toContain('id="spec-aide/70-an-old-spec"');
    expect(html).toContain('data-spec-detail="aide/70-an-old-spec"');
  });

  test("/specs?open= leads to the spec's address with the rest of the query (AC-4)", async () => {
    const { base } = start();
    const res = await fetch(`${base}/specs?open=${encodeURIComponent(`aide/${SPEC},aide/82-other`)}&q=queue`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/specs/aide/${SPEC}?q=queue`);
  });

  test("/specs draws every row shut, without the spec (AC-3)", async () => {
    const { base } = start();
    const html = await (await fetch(`${base}/specs`)).text();
    expect(html).not.toContain('<tr class="specdetail"');
    expect(html).not.toMatch(/<a class="fold"[^>]*aria-expanded="true"/);
    expect(html).toMatch(/<a class="fold shut"[^>]*aria-expanded="false"/);
  });

  // The spec's view reads its files through git; the list's answers must not.
  test("the spec is loaded when its row is opened, not when the list is drawn (AC-2)", async () => {
    const real = createGitRunner();
    const hits: string[] = [];
    const gitRun: GitRunner = (cwd, args, timeoutMs, env) => {
      hits.push(args.join(" "));
      return real(cwd, args, timeoutMs, env);
    };
    const { base } = start({ gitRun });
    const reads = (): number => hits.filter((h) => /\d-(description|analysis|solution|status)\.md/.test(h)).length;

    await (await fetch(`${base}/specs`)).text();
    await (await fetch(`${base}/specs?rows=1`)).text();
    const stand = await (await fetch(`${base}${PATH}?rows=1`)).text();
    const none = reads();
    expect(stand).toContain(`data-spec-detail="aide/${SPEC}"`);
    expect(stand).not.toContain("trackingform");

    await (await fetch(`${base}${PATH}`)).text();
    expect(reads()).toBeGreaterThan(none);
  });

  test("a spec nobody has is a 404, not a blank page", async () => {
    const { base } = start();
    expect((await fetch(`${base}/specs/aide/99-no-such-spec`)).status).toBe(404);
    expect((await fetch(`${base}/specs/no-such-project/${SPEC}`)).status).toBe(404);
  });

  // The two routes are one path segment apart and must stay disjoint:
  // a job id has no slash in it, and a spec page has no job.
  test("the job route still answers, and neither swallows the other", async () => {
    const { base } = start();
    const id = await enqueue(base);
    expect((await fetch(`${base}/jobs/${id}`)).status).toBe(200);
    expect((await fetch(`${base}${PATH}`)).status).toBe(200);
    // The job page is about the run; the spec page is about the spec.
    // An analyze job's page carries 3-solution.md, its own phase's
    // file, and none of the other three the spec page lists.
    const job = await (await fetch(`${base}/jobs/${id}`)).text();
    expect(job).not.toContain("1-description.md");
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
    expect(await (await fetch(`${base}${analysis}`)).text()).toContain("sentinel-first-write");
    writeFileSync(join(spec, "2-analysis.md"), "sentinel-second-write\n");
    const html = await (await fetch(`${base}${analysis}`)).text();
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

  // The spec is drawn in the open row of the Specs list. The rest of the
  // list (the header's language links, the freshness marks of its rows) varies
  // with the address and the clock, so what is compared is the spec's own cell.
  const detailOf = (html: string): string => html.match(/<tr class="specdetail"[\s\S]*?<tr class="specgap"/)?.[0] ?? "";

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
    const bare = detailOf(await (await fetch(`${base2}${PATH}?tab=steps`)).text());
    const res = await fetch(`${base2}${PATH}?tab=steps&job=older-attempt`);
    expect(res.status).toBe(200);
    expect(bare).toContain("$7.77");
    expect(detailOf(await res.text())).toBe(bare);
  });

  test("both attempts' cost figures are present together in one response (AC7)", async () => {
    const { base, dir } = start();
    const id = await enqueue(base);
    const mirror = twoAttempts(dir, id);

    const { base: base2 } = start({ queueMirrorPath: mirror });
    const html = await (await fetch(`${base2}${PATH}?tab=steps`)).text();
    expect(html).toContain("$7.77");
    expect(html).toContain("$1.11");
  });

});
