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
import type { ServerOptions } from "../src/serve.ts";
import type { QueueDefaults } from "../src/queue.ts";
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
  test("shows what the job IS: its spec's title and description (criterion 1)", async () => {
    const { base } = start();
    const id = await enqueue(base);
    const res = await fetch(`${base}/specs/${id}`, auth);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("A running job is a black box");
    expect(html).toContain("It shows nothing about what the job IS");
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
    const html = await (await fetch(`${base2}/specs/${id}?tab=steps`, auth)).text();
    expect(html).toContain("analyze");
    expect(html).toContain("review");
    expect(html).toContain("$0.42");
    expect(html).toContain("$1.07");
  });

  // The tab is a link, so the route has to honour it — a page that
  // ignored `?tab=` would always show the overview and the tabs would
  // be decoration.
  test("the route opens the tab the link asked for", async () => {
    const { base } = start();
    const id = await enqueue(base, ["analyze"]);
    const html = await (await fetch(`${base}/specs/${id}?tab=activity`, auth)).text();
    expect(html).toMatch(/aria-current="page"[^>]*>Activity/);
    expect(html).toContain("Nothing has been captured");
  });
});

// --- spec 04: a finished job does not say its work is unmerged ---------------

// The badge is derived from git at render time, not stored on the job,
// so the only way to prove it reaches the page is through the real
// routes with the git call injected.
describe("a job's branch says whether it landed (criteria 1-3, 5)", () => {
  const BRANCH = "https://example.test/compare/aide/81-queue-and-runner";

  /** Seed a done job with a branch link, the way a finished step leaves
   *  it, and hand back a mirror a second server can read. */
  async function seeded(): Promise<{ mirror: string; id: string }> {
    const { base, dir } = start();
    const id = await enqueue(base);
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(await Bun.file(mirror).text()) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === id)!;
    job.state = "done";
    job.branchUrl = BRANCH;
    writeFileSync(mirror, JSON.stringify(jobs));
    return { mirror, id };
  }

  const gitAnswering = (isAncestorExit: number) => async (_dir: string, args: string[]) => {
    if (args[0] === "symbolic-ref") return { code: 0, stdout: "refs/remotes/origin/master\n" };
    if (args[0] === "merge-base") return { code: isAncestorExit, stdout: "" };
    return { code: 0, stdout: "" };
  };

  test("an unmerged branch is called out on both pages (criteria 1, 3)", async () => {
    const { mirror, id } = await seeded();
    const { base } = start({ queueMirrorPath: mirror, gitRun: gitAnswering(1) });
    expect(await (await fetch(`${base}/`, auth)).text()).toContain("ready to merge");
    expect(await (await fetch(`${base}/specs/${id}`, auth)).text()).toContain("ready to merge");
  });

  test("once the branch has landed the caveat is gone (criterion 2)", async () => {
    const { mirror, id } = await seeded();
    const { base } = start({ queueMirrorPath: mirror, gitRun: gitAnswering(0) });
    const list = await (await fetch(`${base}/`, auth)).text();
    expect(list).not.toContain("ready to merge");
    expect(list).toContain(BRANCH);
    expect(await (await fetch(`${base}/specs/${id}`, auth)).text()).not.toContain("ready to merge");
  });

  // Criterion 5: uncertainty never hides the caveat. A git that cannot
  // answer at all — no checkout, an offline remote, a timeout — must
  // leave the page saying what it said before the check existed.
  test("a git that cannot answer still shows the caveat (criterion 5)", async () => {
    const { mirror, id } = await seeded();
    const { base } = start({
      queueMirrorPath: mirror,
      gitRun: async () => {
        throw new Error("not a git repository");
      },
    });
    expect(await (await fetch(`${base}/`, auth)).text()).toContain("ready to merge");
    expect(await (await fetch(`${base}/specs/${id}`, auth)).text()).toContain("ready to merge");
  });
});

// --- spec 89: one line per repo, each with its own merge state ---------------

// A job that touches two repositories creates a branch of the SAME NAME
// in both, with different contents and two separate compare pages. One
// link and one boolean cannot say that the project's branch landed and
// the specs repo's did not — which is exactly the state that went
// unnoticed three times on 2026-08-17.
describe("every branch a spec made, with its own merge state (criteria 1, 2, 9)", () => {
  const PROJECT_REPO = "/repos/aide";
  const SPECS_REPO = "/repos/aide-specs";
  const PROJECT_URL = "https://example.test/aide/compare";
  const SPECS_URL = "https://example.test/aide-specs/compare";

  async function seededWith(branchUrls: { root: string; url: string }[]): Promise<{ mirror: string; id: string }> {
    const { base, dir } = start();
    const id = await enqueue(base);
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(await Bun.file(mirror).text()) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === id)!;
    job.state = "done";
    job.branchUrls = branchUrls;
    job.branchUrl = branchUrls[0]?.url;
    writeFileSync(mirror, JSON.stringify(jobs));
    return { mirror, id };
  }

  /** Merged in the repos named, unmerged everywhere else. */
  const gitMergedIn = (roots: string[]) => async (dir: string, args: string[]) => {
    if (args[0] === "symbolic-ref") return { code: 0, stdout: "refs/remotes/origin/master\n" };
    if (args[0] === "merge-base") return { code: roots.includes(dir) ? 0 : 1, stdout: "" };
    return { code: 0, stdout: "" };
  };

  const count = (html: string, needle: string): number => html.split(needle).length - 1;

  test("both repos' branches are shown, not one standing in for both (criterion 1)", async () => {
    const { mirror, id } = await seededWith([
      { root: PROJECT_REPO, url: PROJECT_URL },
      { root: SPECS_REPO, url: SPECS_URL },
    ]);
    const { base } = start({ queueMirrorPath: mirror, gitRun: gitMergedIn([]) });
    for (const page of [`/`, `/specs/${id}`]) {
      const html = await (await fetch(`${base}${page}`, auth)).text();
      expect(html).toContain(PROJECT_URL);
      expect(html).toContain(SPECS_URL);
      // Each repo is named, so a reader knows WHICH branch is which.
      expect(html).toContain("aide-specs");
      expect(count(html, ">ready to merge<")).toBe(2);
    }
  });

  // The bug in four lines (2-analysis.md, finding 1): `isMerged` was
  // always asked about `projectDir(job.project)`, so a specs repo left
  // unmerged was invisible — and could even be answered confidently and
  // wrongly by a stale ref of the same name in the project.
  test("a merged repo loses its caveat while the other keeps it (criterion 2)", async () => {
    const { mirror, id } = await seededWith([
      { root: PROJECT_REPO, url: PROJECT_URL },
      { root: SPECS_REPO, url: SPECS_URL },
    ]);
    const { base } = start({ queueMirrorPath: mirror, gitRun: gitMergedIn([PROJECT_REPO]) });
    for (const page of [`/`, `/specs/${id}`]) {
      const html = await (await fetch(`${base}${page}`, auth)).text();
      expect(count(html, ">ready to merge<")).toBe(1);
      // The caveat belongs to the specs repo, and to it alone.
      const specsPart = html.slice(html.indexOf(SPECS_URL));
      expect(specsPart.slice(0, 300)).toContain("ready to merge");
    }
  });

  // `paceup` and `atlasaurus` keep their specs inside the project repo,
  // so a job there touches one repo and makes one branch. That is the
  // NORMAL shape, and it must render through the same code — a list of
  // length one, not a separate single-branch template.
  test("one repo renders as a list of one, through the same markup (criterion 9)", async () => {
    const { mirror } = await seededWith([{ root: PROJECT_REPO, url: PROJECT_URL }]);
    const { base } = start({ queueMirrorPath: mirror, gitRun: gitMergedIn([]) });
    const one = await (await fetch(`${base}/`, auth)).text();

    const two = await seededWith([
      { root: PROJECT_REPO, url: PROJECT_URL },
      { root: SPECS_REPO, url: SPECS_URL },
    ]);
    const { base: base2 } = start({ queueMirrorPath: two.mirror, gitRun: gitMergedIn([]) });
    const many = await (await fetch(`${base2}/`, auth)).text();

    expect(count(one, `class="branch"`)).toBe(1);
    expect(count(many, `class="branch"`)).toBe(2);
    expect(count(one, "branchlist")).toBe(count(many, "branchlist"));
  });

  // A job written before this spec shipped has `branchUrl` and no
  // `branchUrls`. It must render exactly as it did — which is what the
  // "spec 04" block above proves, unmodified, and this restates for the
  // one thing that block does not look at: the repo it was checked in.
  test("a job from before this spec still shows its one branch (criterion 6)", async () => {
    const { base, dir } = start();
    const id = await enqueue(base);
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(await Bun.file(mirror).text()) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === id)!;
    job.state = "done";
    job.branchUrl = PROJECT_URL; // and no branchUrls at all
    writeFileSync(mirror, JSON.stringify(jobs));
    const { base: base2 } = start({ queueMirrorPath: mirror, gitRun: gitMergedIn([]) });
    const html = await (await fetch(`${base2}/`, auth)).text();
    expect(count(html, `class="branch"`)).toBe(1);
    expect(html).toContain(PROJECT_URL);
    expect(html).toContain("ready to merge");
  });
});

// --- spec 89: the button that does the merging -------------------------------
// --- spec 96: and what, exactly, it will merge -------------------------------

// The count told a reader how MANY repos, never which kind. "Merge (1)"
// on a spec mid-`review-plan` meant "merge the plan the running step is
// about to rewrite" — three facts a reader had to combine themselves.
// The button now says the conclusion, and is not the default action
// while a step is still writing to the branch.
describe("the Merge button says what it will merge (criteria 1-8)", () => {
  const PROJECT_REPO = "/repos/aide";
  const SPECS_REPO = "/repos/aide-specs";

  async function seededWith(
    branchUrls: { root: string; url: string }[],
    state = "done",
  ): Promise<string> {
    const { base, dir } = start();
    const id = await enqueue(base);
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(await Bun.file(mirror).text()) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === id)!;
    job.state = state;
    job.branchUrls = branchUrls;
    writeFileSync(mirror, JSON.stringify(jobs));
    return mirror;
  }

  const gitMergedIn = (roots: string[]) => async (dir: string, args: string[]) => {
    if (args[0] === "symbolic-ref") return { code: 0, stdout: "refs/remotes/origin/master\n" };
    if (args[0] === "merge-base") return { code: roots.includes(dir) ? 0 : 1, stdout: "" };
    return { code: 0, stdout: "" };
  };

  const listWith = async (mirror: string, merged: string[] = []) => {
    const { base } = start({ queueMirrorPath: mirror, gitRun: gitMergedIn(merged) });
    return await (await fetch(`${base}/`, auth)).text();
  };

  // The two repos a spec in THIS project makes: `aide` is the project's
  // own checkout — its basename is the project's name, by construction —
  // and `aide-specs` is not a project on this machine at all, which is
  // exactly what makes it the specs repo.
  const BOTH = [
    { root: PROJECT_REPO, url: "https://example.test/aide" },
    { root: SPECS_REPO, url: "https://example.test/aide-specs" },
  ];

  // Spec 132 moved the sentence off the button and onto the State
  // line — the row states which repos are open, and the press itself
  // lives in the panel. What 96 was for is unchanged: a reader is still
  // told WHETHER the plan or the code is what would land.
  test("both repos unmerged reads \"ready to merge plan and code\" (criterion 5)", async () => {
    const html = await listWith(await seededWith(BOTH));
    expect(html).toContain(">ready to merge plan and code<");
    expect(html).not.toContain("/merge");
  });

  test("only the specs repo left reads \"ready to merge the plan\" (criterion 3)", async () => {
    const html = await listWith(await seededWith(BOTH), [PROJECT_REPO]);
    expect(html).toContain(">ready to merge the plan<");
    expect(html).not.toContain("ready to merge plan and code");
    expect(html).not.toContain("ready to merge the code");
  });

  test("only the project repo left reads \"ready to merge the code\" (criterion 4)", async () => {
    const html = await listWith(await seededWith(BOTH), [SPECS_REPO]);
    expect(html).toContain(">ready to merge the code<");
    expect(html).not.toContain("ready to merge the plan");
  });

  // `paceup` and `atlasaurus` keep their specs INSIDE the project repo,
  // so a spec there has one branch whose label is the project's own
  // name. That is code, and calling it "the plan" would be exactly
  // backwards on the two projects with the most runs.
  test("a spec whose only repo is the project itself merges code, never a plan (criterion 6)", async () => {
    const html = await listWith(await seededWith([{ root: PROJECT_REPO, url: "https://example.test/aide" }]));
    expect(html).toContain(">ready to merge the code<");
    expect(html).not.toContain("ready to merge the plan");
  });

  // The description's own read-off-the-page: a `Merge (1)` button,
  // enabled, while the step writing that very plan was still running.
  // It was disabled first, and since spec 105 it is not drawn at all —
  // a busy spec's row offers Cancel and nothing else, and a control
  // that cannot be pressed is one more thing to read past.
  test("while a step is still running there is no Merge button at all (criterion 1)", async () => {
    const html = await listWith(await seededWith(BOTH, "running"));
    expect(html).not.toContain('class="mergeform"');
    expect(html).not.toContain("/merge");
    expect(html).not.toContain("ready to merge");
  });

  // Gone since 2026-08-19: the small "merge anyway" behind a confirm was
  // never used on purpose and read as nonsense without its context.
  // Merging mid-job means cancelling the job first.
  test("no override beside it either while a step runs", async () => {
    const html = await listWith(await seededWith(BOTH, "running"));
    expect(html).not.toContain('class="mergeoverride"');
    expect(html).not.toContain("merge anyway");
    expect(html).not.toContain("confirm(");
  });

  // Since spec 132 a finished job's ROW carries no button at all — the
  // press is in the panel, where every other action already lived. That
  // the panel's own Merge is enabled for exactly this case is proved in
  // `render.test.ts`, "Merge is disabled, never absent…".
  test("a finished job's row offers no button, and no override beside it", async () => {
    const html = await listWith(await seededWith(BOTH));
    expect(html).not.toContain('class="mergeoverride"');
    expect(html).not.toContain("merge anyway");
    expect(html).not.toContain('class="mergeform"');
  });

  test("everything already merged leaves no button at all (criterion 7)", async () => {
    const mirror = await seededWith([{ root: PROJECT_REPO, url: "https://example.test/aide" }]);
    expect(await listWith(mirror, [PROJECT_REPO])).not.toContain("/merge");
  });

  test("a spec that never pushed anywhere has nothing to merge (criterion 8)", async () => {
    const { base } = start();
    await enqueue(base);
    const html = await (await fetch(`${base}/`, auth)).text();
    expect(html).not.toContain("/merge");
  });
});

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
    timeoutSec: 1200,
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
    const activity = await (await fetch(`${base2}/specs/${id}?tab=activity`, auth)).text();
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
    const html = await (await fetch(`${base2}/specs/${id}?tab=activity`, auth)).text();
    expect(html).toContain("bun test");
  });
});
