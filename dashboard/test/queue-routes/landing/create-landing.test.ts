// Split out of create-and-archive.test.ts by theme.

import { repoOf } from "./every-step-lands-fixtures.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ServerOptions } from "../../../src/serve/serve.ts";
import { renderSentence } from "../../../src/i18n/message.ts";

/** The message a job carries, as text. Since spec 380 a job stores
 *  WHICH message and what fills its blanks; the reader composes it.
 *  These tests assert on what a reader would see, so they compose it
 *  the same way, in English. */
function sentence(s: unknown): string {
  return renderSentence("en", s as Parameters<typeof renderSentence>[1]) ?? "";
}

import {
  TOKEN,
  JOB,
  specHead,
  specControls,
  openQuery,
  setupQueueRoutesHarness,
} from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
const SPECS_REPO = "/repos/aide-specs";

function gitFor({
  conflicting = [],
  needsRealMerge = [],
  gone = [],
}: {
  conflicting?: string[];
  needsRealMerge?: string[];
  gone?: string[];
} = {}) {
  const calls: { dir: string; args: string[] }[] = [];
  const run = async (dir: string, args: string[]) => {
    calls.push({ dir, args });
    const a = args.join(" ");
    if (a.startsWith("ls-remote") && gone.includes(dir)) return { code: 2, stdout: "" };
    if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
    if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
    if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
    if (a.startsWith("merge -q --ff-only origin/")) return { code: 0, stdout: "" };
    if (a.startsWith("merge -q --ff-only")) {
      return { code: conflicting.includes(repoOf(dir)) || needsRealMerge.includes(repoOf(dir)) ? 1 : 0, stdout: "" };
    }
    if (a.startsWith("merge -q --no-edit")) return { code: conflicting.includes(repoOf(dir)) ? 1 : 0, stdout: "" };
    if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
    return { code: 0, stdout: "" };
  };
  return { run, calls };
}

function serverWithRunner(
  start: (options: Partial<ServerOptions>) => { base: string; dir: string },
  prefix: string,
  git: { run: (dir: string, args: string[]) => Promise<unknown> },
  extra: Partial<ServerOptions> = {},
) {
  const results = mkdtempSync(join(tmpdir(), prefix));
  ownDirs.push(results);
  const { base, dir } = start({
    queueToken: TOKEN,
    gitRun: git.run as never,
    queueRunnerBin: "/usr/bin/true",
    queueResultDir: results,
    ...extra,
  });
  return { base, dir, results };
}

async function settle(
  base: string,
  id: string,
  done: (job: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  for (let n = 0; n < 100; n++) {
    const res = await fetch(`${base}/api/queue/${id}`, { headers: AUTH });
    const body = (await res.json()) as { job: Record<string, unknown> };
    if (done(body.job)) return body.job;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the job never settled");
}

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

// A refusal has to land where the person who pressed the button can
// read it. Answering a form post with a JSON body puts the reason on a
// blank page with no way back.
describe("a refused form post says so on the page", () => {
  test("a duplicate returns to / carrying the reason, and the page shows it", async () => {
    const { base } = start({ queueToken: TOKEN });
    const post = () =>
      fetch(`${base}/api/queue`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
        body: new URLSearchParams({ target: "aide/81-queue-and-runner", steps: "analyze" }),
      });
    expect((await post()).status).toBe(303);

    const again = await post();
    expect(again.status).toBe(303);
    const location = again.headers.get("location") ?? "";
    expect(location.startsWith("/?")).toBe(true);
    expect(decodeURIComponent(location)).toContain("already queued");

    const html = await (
      await fetch(`${base}${location}`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    expect(html).toContain("already queued");
    // And only one job was made.
    const listed = (await (
      await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } })
    ).json()) as { jobs: unknown[] };
    expect(listed.jobs.length).toBe(1);
  });

  test("a JSON caller still gets a 400 with the reason, not a redirect", async () => {
    const { base } = start({ queueToken: TOKEN });
    const post = () =>
      fetch(`${base}/api/queue`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
        body: JSON.stringify(JOB),
      });
    expect((await post()).status).toBe(200);
    const again = await post();
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toContain("already");
  });
});

// A create step's work is on a branch, in a worktree, on the machine that
// ran it. The list reads the main checkout and nothing else, so the spec
// stays invisible until that branch is merged — which is why this one step
// lands itself instead of waiting for a button nobody was told to press.
describe("landing a created spec (spec 93)", () => {
  const BRANCH = "aide/new-abc123de";

  /** The result `aide-run-spec` writes for a create step that worked. */
  const CREATE_RESULT = {
    ok: true,
    exitCode: 0,
    costUsd: 0.4,
    costMeasured: true,
    terminalReason: "completed",
    branch: BRANCH,
    specFolder: "94-a-new-spec",
    branchUrls: [{ root: SPECS_REPO, url: "https://example.test/aide-specs" }],
    repos: [],
  };

  async function createJob(base: string, title = "A new spec"): Promise<{ id: string; specFolder: string }> {
    const made = (await (
      await fetch(`${base}/api/queue/create`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", title, description: "Do the thing" }),
      })
    ).json()) as { job: { id: string; specFolder: string } };
    return made.job;
  }

  test("a successful create step is merged into every repo it pushed to, and renamed", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(start, "aide-create-results-", git);
    const job = await createJob(base);
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CREATE_RESULT));
    await settle(base, job.id, (j) => j.specFolder === "94-a-new-spec");

    // The branch `aide-run-spec` REPORTED, never one re-derived from a
    // folder name that did not exist when the branch was made.
    const merges = git.calls.filter(
      (c) => c.args[0] === "merge" && c.args.includes(`refs/remotes/origin/${BRANCH}`),
    );
    expect(merges.length).toBeGreaterThan(0);
    expect(merges.every((c) => repoOf(c.dir) === SPECS_REPO)).toBe(true);
    expect(git.calls.some((c) => repoOf(c.dir) === SPECS_REPO && c.args[0] === "push")).toBe(true);

    const landedJob = await settle(base, job.id, () => true);
    expect(landedJob.error).toBeFalsy();
    expect(landedJob.landing).toBeFalsy();
  });

  // The landing races the runs that pull the same checkout: 111 and 112
  // were both stranded by a first-try index.lock loss. A transient
  // failure is retried; only a merge that keeps failing is reported.
  test("a landing that fails once and then succeeds lands on the retry", async () => {
    let failures = 1;
    const inner = gitFor();
    const git = {
      calls: inner.calls,
      run: (dir: string, args: string[]) => {
        if (args.join(" ").startsWith("merge -q --no-edit") && dir === SPECS_REPO && failures > 0) {
          failures -= 1;
          return Promise.resolve({ code: 1, stdout: "", stderr: "index.lock" });
        }
        return inner.run(dir, args);
      },
    };
    const { base, results } = serverWithRunner(start, "aide-create-results-", git as never);
    const job = await createJob(base);
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CREATE_RESULT));
    const landed = await settle(base, job.id, (j) => j.specFolder !== job.specFolder || !!j.error);
    expect(landed.error).toBeFalsy();
    expect(landed.specFolder).not.toBe(job.specFolder);
  });

  test("a landing that fails keeps the provisional key and says which repo and why", async () => {
    const git = gitFor({ conflicting: [SPECS_REPO] });
    const { base, results } = serverWithRunner(start, "aide-create-results-", git);
    const job = await createJob(base);
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CREATE_RESULT));
    const failed = await settle(base, job.id, (j) => !!j.error);

    expect(failed.specFolder).toBe(job.specFolder);
    expect(sentence(failed.error)).toContain(SPECS_REPO);
    expect(failed.landing).toBeFalsy();
    // Nothing half-merged is left for the next thing to trip over.
    expect(git.calls.some((c) => repoOf(c.dir) === SPECS_REPO && c.args.join(" ") === "merge --abort")).toBe(true);
  });

  test("a landed spec is an ordinary row: analyze runnable, nothing left to merge", async () => {
    const git = gitFor();
    const { base, dir, results } = serverWithRunner(start, "aide-create-results-", git);
    const job = await createJob(base);
    // The merge really does put the folder on disk, which is the whole
    // reason the landing step exists.
    mkdirSync(join(dir, "root", "aide", "specs", "94-a-new-spec"), { recursive: true });
    writeFileSync(
      join(dir, "root", "aide", "specs", "94-a-new-spec", "1-description.md"),
      "# A new spec - Description\n",
    );
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CREATE_RESULT));
    await settle(base, job.id, (j) => j.specFolder === "94-a-new-spec");

    const html = await (
      await fetch(`${base}/?${openQuery("aide/94-a-new-spec")}`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    const row = specHead(html, "94-a-new-spec");
    expect(row).not.toBe("");
    const group = specControls(html, "94-a-new-spec");
    // Runnable from its own phase lines, like every other spec...
    expect(group).toContain('name="steps" value="analyze"');
    // ...and with nothing left to merge: the branch is landed, and
    // since spec 149 there is no control to merge it with either.
    expect(group).not.toContain("/merge");
    expect(group).not.toContain(">Merge</button>");
    expect(group).not.toContain("ready to merge");
  });

  test("a create job that has not landed yet is still a row on the page", async () => {
    // `groupBySpec` drops any job whose spec is not a known target. A
    // create job's spec is unknown BY CONSTRUCTION until it lands, so
    // without an allowance the job running right now renders nothing.
    const { base } = start({ queueToken: TOKEN });
    const job = await createJob(base, "A brand new spec");
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain(job.specFolder);
    // Labelled by its title: the provisional key says nothing to anyone.
    expect(html).toContain("A brand new spec");
  });

  // --- spec 342, REQ-5: a job that goes create -> analyze in one run ---------
  //
  // No job's `steps` had ever carried a second entry after `create`
  // before this spec — the New spec page's phase table is what first
  // lets a reader ask for it. The runner's own mechanism (the "nothing
  // starts while a job is landing" gate in `runner.ts`, and `startOne`
  // re-reading `job.specFolder` fresh off the store every tick) is
  // generic and was never written FOR this case, but had never been
  // exercised by it either — so this proves it end to end rather than
  // trusting the reasoning.
  test("REQ-5: the step after create runs under the spec's real, renamed folder", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(start, "aide-create-results-", git);
    const made = (await (
      await fetch(`${base}/api/queue/create`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({
          project: "aide",
          title: "A new spec",
          description: "Do the thing",
          steps: ["analyze"],
        }),
      })
    ).json()) as { job: { id: string; specFolder: string; steps: string[] } };
    expect(made.job.steps).toEqual(["create", "analyze"]);
    const job = made.job;

    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CREATE_RESULT));
    await settle(base, job.id, (j) => j.specFolder === "94-a-new-spec");

    // The next step starts running under the RENAMED folder — never the
    // provisional key `create` was queued under.
    const running = await settle(base, job.id, (j) => j.state === "running" && j.stepIndex === 1);
    expect(running.specFolder).toBe("94-a-new-spec");
    expect(running.steps).toEqual(["create", "analyze"]);

    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({
        ok: true, exitCode: 0, costUsd: 0.05, costMeasured: true, terminalReason: "completed", repos: [],
      }),
    );
    const done = await settle(base, job.id, (j) => j.state === "done");
    expect(done.specFolder).toBe("94-a-new-spec");
  }, 20000);
});
