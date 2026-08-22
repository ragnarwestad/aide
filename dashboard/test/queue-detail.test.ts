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
  // Spec 150: the `## Description` prose left this page for the spec
  // page, where the whole file is one of four. The title stays — a
  // reader still has to know which spec the job is about — and the
  // phase's own file takes the prose's place.
  test("shows what the job IS: its spec's title and its phase's file (criterion 1)", async () => {
    const { base, dir } = start();
    writeFileSync(
      join(dir, "root", "aide", "specs", "81-queue-and-runner", "2-analysis.md"),
      "# Q - Analysis\n\n## Findings\n\nSeven files, one route.\n",
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

  // Spec 150 took the branch off the job page — it is on the row the
  // page is opened from, and the Overview is now what is said nowhere
  // else — so the list is where the caveat is asserted.
  test("an unmerged branch is called out on the row (criteria 1, 3)", async () => {
    const { mirror } = await seeded();
    const { base } = start({ queueMirrorPath: mirror, gitRun: gitAnswering(1) });
    expect(await (await fetch(`${base}/`, auth)).text()).toContain("waiting for archive");
  });

  test("once the branch has landed the caveat is gone (criterion 2)", async () => {
    const { mirror, id } = await seeded();
    const { base } = start({ queueMirrorPath: mirror, gitRun: gitAnswering(0) });
    const list = await (await fetch(`${base}/`, auth)).text();
    expect(list).not.toContain("waiting for archive");
    expect(list).toContain(BRANCH);
    // and the job page carries neither, since spec 150
    expect(await (await fetch(`${base}/specs/${id}`, auth)).text()).not.toContain(BRANCH);
    expect(await (await fetch(`${base}/specs/${id}`, auth)).text()).not.toContain("waiting for archive");
  });

  // Criterion 5: uncertainty never hides the caveat. A git that cannot
  // answer at all — no checkout, an offline remote, a timeout — must
  // leave the page saying what it said before the check existed.
  test("a git that cannot answer still shows the caveat (criterion 5)", async () => {
    const { mirror } = await seeded();
    const { base } = start({
      queueMirrorPath: mirror,
      gitRun: async () => {
        throw new Error("not a git repository");
      },
    });
    expect(await (await fetch(`${base}/`, auth)).text()).toContain("waiting for archive");
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
    // The row, and the row alone, since spec 150 took the branch list
    // off the job page.
    const html = await (await fetch(`${base}/`, auth)).text();
    expect(html).toContain(PROJECT_URL);
    expect(html).toContain(SPECS_URL);
    // Each repo is named, so a reader knows WHICH branch is which.
    expect(html).toContain("aide-specs");
    expect(count(html, ">waiting for archive<")).toBe(2);
    const job = await (await fetch(`${base}/specs/${id}`, auth)).text();
    expect(job).not.toContain(PROJECT_URL);
    expect(job).not.toContain(SPECS_URL);
  });

  // The bug in four lines (2-analysis.md, finding 1): `isMerged` was
  // always asked about `projectDir(job.project)`, so a specs repo left
  // unmerged was invisible — and could even be answered confidently and
  // wrongly by a stale ref of the same name in the project.
  test("a merged repo loses its caveat while the other keeps it (criterion 2)", async () => {
    const { mirror } = await seededWith([
      { root: PROJECT_REPO, url: PROJECT_URL },
      { root: SPECS_REPO, url: SPECS_URL },
    ]);
    const { base } = start({ queueMirrorPath: mirror, gitRun: gitMergedIn([PROJECT_REPO]) });
    const html = await (await fetch(`${base}/`, auth)).text();
    expect(count(html, ">waiting for archive<")).toBe(1);
    // The caveat belongs to the specs repo, and to it alone.
    const specsPart = html.slice(html.indexOf(SPECS_URL));
    expect(specsPart.slice(0, 300)).toContain("waiting for archive");
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
    expect(html).toContain("waiting for archive");
  });
});

// --- spec 89: the button that does the merging -------------------------------
// --- spec 96: and what, exactly, it will merge -------------------------------

// The count told a reader how MANY repos, never which kind. "Merge (1)"
// on a spec mid-`review-plan` meant "merge the plan the running step is
// about to rewrite" — three facts a reader had to combine themselves.
// The button now says the conclusion, and is not the default action
// while a step is still writing to the branch.
// Spec 96 gave the Merge button a sentence naming WHICH repo it would
// land; spec 132 moved that sentence onto the State line. Spec 149
// removed both — every step lands its own work, so the State line says
// which PHASE is next instead, and the per-repo badge says what each
// branch is waiting for.
describe("what an open branch says about itself (criteria 1-8)", () => {
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

  // One badge per open branch, and the row says nothing at all about a
  // merge: naming which repo a press would land was the press's own
  // sentence, and there is no press (spec 149).
  test("each open branch carries its own badge, and no row asks for a merge", async () => {
    const html = await listWith(await seededWith(BOTH));
    expect(html.match(/>waiting for archive</g)).toHaveLength(2);
    expect(html).not.toContain("ready to merge");
    expect(html).not.toContain("/merge");
  });

  test("a repo that has landed loses its badge; the other keeps it", async () => {
    const html = await listWith(await seededWith(BOTH), [PROJECT_REPO]);
    expect(html.match(/>waiting for archive</g)).toHaveLength(1);
    expect(html).not.toContain("ready to merge");
  });

  // `paceup` and `atlasaurus` keep their specs INSIDE the project repo,
  // so a spec there has one branch whose label is the project's own
  // name. It is worded exactly as the two-repo case — which repo it is
  // stopped being something the row has to say.
  test("a spec whose only repo is the project itself reads the same way", async () => {
    const html = await listWith(await seededWith([{ root: PROJECT_REPO, url: "https://example.test/aide" }]));
    expect(html.match(/>waiting for archive</g)).toHaveLength(1);
    expect(html).not.toContain("ready to merge");
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
    // Spec 174: the repo mark reads the same while a step runs as after
    // it — the branch is open either way, and the State column is where
    // the running step's verb is said.
    expect(html).toContain("waiting for archive");
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

  test("shows all four files, whether or not anything has ever run (criterion 2)", async () => {
    const { base, dir } = start();
    fillSpec(dir);
    const res = await fetch(`${base}${PATH}`, auth);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    for (const name of ["1-description.md", "2-analysis.md", "3-solution.md", "4-status.md"]) {
      expect(html).toContain(name);
    }
    expect(html).toContain("Seven files.");
    expect(html).toContain("One must-fix.");
    expect(html).toContain("not started");
  });

  test("with a lead job it shows that job's Activity and Steps (criterion 1)", async () => {
    const { base, dir } = start();
    fillSpec(dir);
    const id = await enqueue(base);
    expect(id).toBeTruthy();
    const html = await (await fetch(`${base}${PATH}?tab=steps`, auth)).text();
    expect(html).toContain("No step has finished yet");
    expect(html).toContain(`href="${PATH}?tab=overview"`);
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
    const job = await (await fetch(`${base}/specs/${id}`, auth)).text();
    expect(job).not.toContain("3-solution.md");
  });

  test("it is behind the token like every other queue path", async () => {
    const { base } = start();
    expect((await fetch(`${base}${PATH}`)).status).toBe(401);
    const { base: off } = start({ queueToken: undefined });
    expect((await fetch(`${off}${PATH}`)).status).toBe(503);
  });

  test("the spec's files are re-read on every request, never served from the 5 s scan", async () => {
    const { base, dir } = start();
    const spec = join(dir, "root", "aide", "specs", SPEC);
    writeFileSync(join(spec, "2-analysis.md"), "before\n");
    expect(await (await fetch(`${base}${PATH}`, auth)).text()).toContain("before");
    writeFileSync(join(spec, "2-analysis.md"), "after\n");
    const html = await (await fetch(`${base}${PATH}`, auth)).text();
    expect(html).toContain("after");
    expect(html).not.toContain("before");
  });
});

// A phase's own page shows what that phase made, and nothing else of
// the spec (criteria 5-7).
describe("a phase job's page shows that phase's file", () => {
  const SPEC = "81-queue-and-runner";

  const withFiles = (dir: string): void => {
    const spec = join(dir, "root", "aide", "specs", SPEC);
    writeFileSync(join(spec, "2-analysis.md"), "# Q - Analysis\n\n## Findings\n\nSeven files.\n");
    writeFileSync(
      join(spec, "3-solution.md"),
      "# Q - Solution\n\n## Plan review\n\nOne must-fix.\n\n## Risk analysis\n\nMedium.\n",
    );
  };

  test("an analyze job shows 2-analysis.md and repeats nothing else", async () => {
    const { base, dir } = start();
    withFiles(dir);
    const id = await enqueue(base, ["analyze"]);
    const html = await (await fetch(`${base}/specs/${id}`, auth)).text();
    expect(html).toContain("Seven files.");
    expect(html).not.toContain("One must-fix.");
    expect(html).not.toContain("It shows nothing about what the job IS");
  });

  test("a review-plan job shows only the Plan review section", async () => {
    const { base, dir } = start();
    withFiles(dir);
    const id = await enqueue(base, ["review-plan"]);
    const html = await (await fetch(`${base}/specs/${id}`, auth)).text();
    expect(html).toContain("One must-fix.");
    expect(html).not.toContain("Medium.");
    expect(html).not.toContain("Seven files.");
  });

  test("an implement job shows 4-status.md", async () => {
    const { base, dir } = start();
    withFiles(dir);
    const id = await enqueue(base, ["implement"]);
    const html = await (await fetch(`${base}/specs/${id}`, auth)).text();
    expect(html).toContain("Workflow steps completed");
  });
});

// --- criteria 3, 4: the Update button ---------------------------------------

describe("POST the Update action", () => {
  const SPEC = "81-queue-and-runner";
  const UPDATE = `/api/queue/specs/aide/${SPEC}/update`;
  const PATH = `/specs/aide/${SPEC}`;

  const press = (base: string) =>
    fetch(`${base}${UPDATE}`, {
      method: "POST",
      headers: { "x-aide-token": TOKEN, "content-type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: "",
    });

  /** A specs checkout that is clean, on its default branch and behind. */
  const pullable = (extra: Record<string, { code: number; stdout?: string }> = {}) => {
    let heads = 0;
    const answers: Record<string, { code: number; stdout?: string }> = {
      "rev-parse --show-toplevel": { code: 0, stdout: "/host/aide-specs\n" },
      "diff --quiet HEAD": { code: 0 },
      "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
      "symbolic-ref --quiet refs/remotes/origin/HEAD": { code: 0, stdout: "refs/remotes/origin/main\n" },
      fetch: { code: 0 },
      "merge-base --is-ancestor": { code: 0 },
      "merge -q --ff-only": { code: 0 },
      "log -1 --format=%H": { code: 0, stdout: "a3f9c21\t2026-08-21T09:14:00+02:00\n" },
      ...extra,
    };
    return async (_dir: string, args: string[]) => {
      const line = args.join(" ");
      if (line === "rev-parse HEAD") {
        return { code: 0, stdout: `${heads++ === 0 ? "a3f9c21" : "7b1e004"}\n` };
      }
      for (const [prefix, answer] of Object.entries(answers)) {
        if (line.startsWith(prefix)) return { code: answer.code, stdout: answer.stdout ?? "" };
      }
      return { code: 1, stdout: "" };
    };
  };

  test("a fast-forwardable checkout is pulled and the reader lands back on the spec page", async () => {
    const { base } = start({ gitRun: pullable() });
    const res = await press(base);
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location.startsWith(PATH)).toBe(true);
    expect(decodeURIComponent(location)).toContain("7b1e004");
  });

  for (const [what, extra, expected] of [
    ["uncommitted changes", { "diff --quiet HEAD": { code: 1 } }, "uncommitted"],
    [
      "a checkout on another branch",
      { "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "aide/150-one-page\n" } },
      "aide/150-one-page",
    ],
    ["a checkout that has diverged", { "merge-base --is-ancestor": { code: 1 } }, "fast-forward"],
    ["a directory that is not a git tree", { "rev-parse --show-toplevel": { code: 128 } }, "git working tree"],
  ] as [string, Record<string, { code: number; stdout?: string }>, string][]) {
    test(`${what} changes nothing and says which one applied (criterion 4)`, async () => {
      const { base } = start({ gitRun: pullable(extra) });
      const res = await press(base);
      expect(res.status).toBe(303);
      const location = decodeURIComponent(res.headers.get("location")!);
      expect(location.startsWith(PATH)).toBe(true);
      expect(location).toContain("error=");
      expect(location).toContain(expected);
    });
  }

  test("the refusal is on the page the button was pressed from, not in a JSON body", async () => {
    const { base } = start({ gitRun: pullable({ "diff --quiet HEAD": { code: 1 } }) });
    const location = decodeURIComponent((await press(base)).headers.get("location")!);
    const html = await (await fetch(`${base}${location}`, auth)).text();
    expect(html).toContain("uncommitted");
  });

  test("a spec nobody has cannot be pulled for", async () => {
    const { base } = start({ gitRun: pullable() });
    const res = await fetch(`${base}/api/queue/specs/aide/99-no-such-spec/update`, {
      method: "POST",
      headers: { "x-aide-token": TOKEN },
      redirect: "manual",
    });
    expect(res.status).toBe(404);
  });

  test("GET is not an update — a pull is a POST like every other action", async () => {
    const { base } = start({ gitRun: pullable() });
    expect((await fetch(`${base}${UPDATE}`, auth)).status).toBe(405);
  });

  test("it is behind the token like every other queue path", async () => {
    const { base } = start({ gitRun: pullable() });
    expect((await fetch(`${base}${UPDATE}`, { method: "POST", redirect: "manual" })).status).toBe(401);
  });

  test("approve, cancel and merge still answer — the new action does not swallow them", async () => {
    const { base } = start({ gitRun: pullable() });
    const id = await enqueue(base);
    const res = await fetch(`${base}/api/queue/${id}/cancel`, {
      method: "POST",
      headers: { "x-aide-token": TOKEN, accept: "application/json" },
    });
    expect(res.status).toBe(200);
  });
});
