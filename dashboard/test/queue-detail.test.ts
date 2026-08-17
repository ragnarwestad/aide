// Criteria 1, 2, 6, 7 (spec 02): the per-job detail page and its JSON
// counterpart. `/specs` shows one row per JOB, so a three-step job shows
// one line and its finished steps are invisible; and the row says
// `02-job-detail-view` without saying what that spec is about.
//
// The two new routes are queue routes like every other: the token guard
// covers them, and an id that names no job is a 404, never a blank page.
import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerOptions } from "../src/serve.ts";
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
    expect(html).toContain("review-plan");
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
    expect(await (await fetch(`${base}/specs`, auth)).text()).toContain("not merged");
    expect(await (await fetch(`${base}/specs/${id}`, auth)).text()).toContain("not merged");
  });

  test("once the branch has landed the caveat is gone (criterion 2)", async () => {
    const { mirror, id } = await seeded();
    const { base } = start({ queueMirrorPath: mirror, gitRun: gitAnswering(0) });
    const list = await (await fetch(`${base}/specs`, auth)).text();
    expect(list).not.toContain("not merged");
    expect(list).toContain(BRANCH);
    expect(await (await fetch(`${base}/specs/${id}`, auth)).text()).not.toContain("not merged");
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
    expect(await (await fetch(`${base}/specs`, auth)).text()).toContain("not merged");
    expect(await (await fetch(`${base}/specs/${id}`, auth)).text()).toContain("not merged");
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
    for (const page of [`/specs`, `/specs/${id}`]) {
      const html = await (await fetch(`${base}${page}`, auth)).text();
      expect(html).toContain(PROJECT_URL);
      expect(html).toContain(SPECS_URL);
      // Each repo is named, so a reader knows WHICH branch is which.
      expect(html).toContain("aide-specs");
      expect(count(html, "not merged")).toBe(2);
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
    for (const page of [`/specs`, `/specs/${id}`]) {
      const html = await (await fetch(`${base}${page}`, auth)).text();
      expect(count(html, "not merged")).toBe(1);
      // The caveat belongs to the specs repo, and to it alone.
      const specsPart = html.slice(html.indexOf(SPECS_URL));
      expect(specsPart.slice(0, 300)).toContain("not merged");
    }
  });

  // `paceup` and `atlasaurus` keep their specs inside the project repo,
  // so a job there touches one repo and makes one branch. That is the
  // NORMAL shape, and it must render through the same code — a list of
  // length one, not a separate single-branch template.
  test("one repo renders as a list of one, through the same markup (criterion 9)", async () => {
    const { mirror } = await seededWith([{ root: PROJECT_REPO, url: PROJECT_URL }]);
    const { base } = start({ queueMirrorPath: mirror, gitRun: gitMergedIn([]) });
    const one = await (await fetch(`${base}/specs`, auth)).text();

    const two = await seededWith([
      { root: PROJECT_REPO, url: PROJECT_URL },
      { root: SPECS_REPO, url: SPECS_URL },
    ]);
    const { base: base2 } = start({ queueMirrorPath: two.mirror, gitRun: gitMergedIn([]) });
    const many = await (await fetch(`${base2}/specs`, auth)).text();

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
    const html = await (await fetch(`${base2}/specs`, auth)).text();
    expect(count(html, `class="branch"`)).toBe(1);
    expect(html).toContain(PROJECT_URL);
    expect(html).toContain("not merged");
  });
});

// --- spec 89: the button that does the merging -------------------------------

describe("the Merge button says what it will take (criterion 3, 7)", () => {
  const PROJECT_REPO = "/repos/aide";
  const SPECS_REPO = "/repos/aide-specs";

  async function seededWith(branchUrls: { root: string; url: string }[]): Promise<string> {
    const { base, dir } = start();
    const id = await enqueue(base);
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(await Bun.file(mirror).text()) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === id)!;
    job.state = "done";
    job.branchUrls = branchUrls;
    writeFileSync(mirror, JSON.stringify(jobs));
    return mirror;
  }

  const gitMergedIn = (roots: string[]) => async (dir: string, args: string[]) => {
    if (args[0] === "symbolic-ref") return { code: 0, stdout: "refs/remotes/origin/master\n" };
    if (args[0] === "merge-base") return { code: roots.includes(dir) ? 0 : 1, stdout: "" };
    return { code: 0, stdout: "" };
  };

  test("with two unmerged repos it offers to merge two, and names them", async () => {
    const mirror = await seededWith([
      { root: PROJECT_REPO, url: "https://example.test/aide" },
      { root: SPECS_REPO, url: "https://example.test/aide-specs" },
    ]);
    const { base } = start({ queueMirrorPath: mirror, gitRun: gitMergedIn([]) });
    const html = await (await fetch(`${base}/specs`, auth)).text();
    expect(html).toContain("/merge");
    expect(html).toContain("Merge (2)");
    expect(html).toContain("aide, aide-specs");
  });

  test("with one repo left it offers to merge one — never a count of what is done", async () => {
    const mirror = await seededWith([
      { root: PROJECT_REPO, url: "https://example.test/aide" },
      { root: SPECS_REPO, url: "https://example.test/aide-specs" },
    ]);
    const { base } = start({ queueMirrorPath: mirror, gitRun: gitMergedIn([PROJECT_REPO]) });
    const html = await (await fetch(`${base}/specs`, auth)).text();
    expect(html).toContain("Merge (1)");
    expect(html).not.toContain("Merge (2)");
  });

  test("everything already merged leaves no button at all", async () => {
    const mirror = await seededWith([{ root: PROJECT_REPO, url: "https://example.test/aide" }]);
    const { base } = start({ queueMirrorPath: mirror, gitRun: gitMergedIn([PROJECT_REPO]) });
    const html = await (await fetch(`${base}/specs`, auth)).text();
    expect(html).not.toContain("/merge");
  });

  test("a spec that never pushed anywhere has nothing to merge", async () => {
    const { base } = start();
    await enqueue(base);
    const html = await (await fetch(`${base}/specs`, auth)).text();
    expect(html).not.toContain("/merge");
  });
});
