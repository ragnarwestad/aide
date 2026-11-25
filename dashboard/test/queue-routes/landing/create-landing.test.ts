// Split out of create-and-archive.test.ts by theme.

import { mergeAnswer, repoOf, settle as settleFor } from "./every-step-lands-fixtures.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ServerOptions } from "../../../src/serve/serve.ts";
import { formatSentence } from "../../../src/messages/format.ts";

/** The message a job carries, as text. A job stores
 *  WHICH message and what fills its blanks; the reader composes it.
 *  These tests assert on what a reader would see, so they compose it
 *  the same way, in English. */
function sentence(s: unknown): string {
  return formatSentence("en", s as Parameters<typeof formatSentence>[1]) ?? "";
}

import { JOB, specHead, specControls, openQuery, setupQueueRoutesHarness } from "../fixtures.ts";
import { WAITING_RUNNER } from "../../helpers/waiting-runner.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

const SPECS_REPO = "/repos/aide-specs";

const legacyCreateJob = (title = "A new spec", extra: Record<string, unknown> = {}) => ({
  id: "legacy-create",
  project: "aide",
  specFolder: "new-abc123de",
  steps: ["create"],
  stepIndex: 0,
  state: "queued",
  timeoutSec: {},
  permissionMode: {},
  model: {},
  results: [],
  createdAt: "2026-10-08T10:00:00Z",
  createTitle: title,
  createDescription: "Do the thing",
  ...extra,
});

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
    const merge = mergeAnswer(a, dir, conflicting, needsRealMerge);
    if (merge) return merge;
    return { code: 0, stdout: "" };
  };
  return { run, calls };
}

/** Landing, never the step's own outcome, decides a create
 *  job's real folder now — this is the finalize step's stand-in, the
 *  same shape `aide-create-spec --assign-number` answers with. A test
 *  that wants a different real name overrides it via `extra`. */
const DEFAULT_FINALIZE_CREATE: ServerOptions["finalizeCreateSpec"] = async () => ({
  ok: true,
  specFolder: "94-a-new-spec",
});

function serverWithRunner(
  start: (
    options: Partial<ServerOptions>,
    alsoProjects?: string[],
    alsoSpecs?: string[],
    status?: string,
    liveState?: string,
    queueMirror?: string,
  ) => { base: string; dir: string },
  prefix: string,
  git: { run: (dir: string, args: string[]) => Promise<unknown> },
  extra: Partial<ServerOptions> = {},
  job = legacyCreateJob(),
) {
  const results = mkdtempSync(join(tmpdir(), prefix));
  ownDirs.push(results);
  const { base, dir } = start(
    {
      gitRun: git.run as never,
      queueRunnerBin: WAITING_RUNNER,
      queueResultDir: results,
      finalizeCreateSpec: DEFAULT_FINALIZE_CREATE,
      ...extra,
    },
    [],
    [],
    undefined,
    undefined,
    JSON.stringify([job]),
  );
  return { base, dir, results, job };
}

/** The job polled until `done` holds, for up to ten seconds. */
const settle = (base: string, id: string, done: (job: Record<string, unknown>) => boolean) =>
  settleFor(base, id, done, 200);

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

// A duplicate press is refused with its reason, however it was posted,
// and makes no second job.
describe("a refused duplicate press", () => {
  test("a form post answers 400 with the reason, and only one job is made", async () => {
    const { base } = start();
    const post = () =>
      fetch(`${base}/api/queue`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ target: "aide/81-queue-and-runner", steps: "analyze" }),
      });
    expect((await post()).status).toBe(200);

    const again = await post();
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toContain("already queued");
    const listed = (await (
      await fetch(`${base}/api/queue`, )
    ).json()) as { jobs: unknown[] };
    expect(listed.jobs.length).toBe(1);
  });

  test("a JSON caller gets a 400 with the reason", async () => {
    const { base } = start();
    const post = () =>
      fetch(`${base}/api/queue`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
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
describe("landing a created spec", () => {
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

  test("a successful create step is merged into every repo it pushed to, and renamed", async () => {
    const git = gitFor();
    const { base, results, job } = serverWithRunner(start, "aide-create-results-", git);
    await settle(base, job.id, (j) => j.state === "running");
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
  // A no-AI create's result carries tool: "none" and costUsd 0
  // — nothing about landing is keyed on how the step ran, only on
  // outcome.ok, so this must land exactly as an AI-run create does.
  test("a create result with tool: \"none\" still lands through landNewSpec", async () => {
    const git = gitFor();
    const { base, results, job } = serverWithRunner(start, "aide-create-results-", git);
    await settle(base, job.id, (j) => j.state === "running");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({ ...CREATE_RESULT, tool: "none", costUsd: 0 }),
    );
    const landedJob = await settle(base, job.id, (j) => j.specFolder === "94-a-new-spec");
    expect(landedJob.error).toBeFalsy();
    expect(landedJob.landing).toBeFalsy();
  });

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
    const { base, results, job } = serverWithRunner(start, "aide-create-results-", git as never);
    await settle(base, job.id, (j) => j.state === "running");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CREATE_RESULT));
    const landed = await settle(base, job.id, (j) => j.specFolder !== job.specFolder || !!j.error);
    expect(landed.error).toBeFalsy();
    expect(landed.specFolder).not.toBe(job.specFolder);
  });

  test("a landing that fails keeps the provisional key and says which repo and why", async () => {
    const git = gitFor({ conflicting: [SPECS_REPO] });
    const { base, results, job } = serverWithRunner(start, "aide-create-results-", git);
    await settle(base, job.id, (j) => j.state === "running");
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
    const { base, dir, results, job } = serverWithRunner(start, "aide-create-results-", git);
    // The merge really does put the folder on disk, which is the whole
    // reason the landing step exists.
    mkdirSync(join(dir, "root", "aide", "specs", "94-a-new-spec"), { recursive: true });
    writeFileSync(
      join(dir, "root", "aide", "specs", "94-a-new-spec", "1-description.md"),
      "# A new spec - Description\n",
    );
    await settle(base, job.id, (j) => j.state === "running");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CREATE_RESULT));
    await settle(base, job.id, (j) => j.specFolder === "94-a-new-spec");

    const html = await (
      await fetch(`${base}/?${openQuery("aide/94-a-new-spec")}`, )
    ).text();
    const row = specHead(html, "94-a-new-spec");
    expect(row).not.toBe("");
    const group = specControls(html, "94-a-new-spec");
    // Runnable from its own phase lines, like every other spec...
    expect(group).toContain('name="steps" value="analyze"');
    // ...and with nothing left to merge: the branch is landed, and
    // there is no control to merge it with either.
    expect(group).not.toContain("/merge");
    expect(group).not.toContain(">Merge</button>");
    expect(group).not.toContain("ready to merge");
  });

  test("a create job that has not landed yet is still a row on the page", async () => {
    // `groupBySpec` drops any job whose spec is not a known target. A
    // create job's spec is unknown BY CONSTRUCTION until it lands, so
    // without an allowance the job running right now renders nothing.
    const job = legacyCreateJob("A brand new spec");
    const { base } = start({}, [], [], undefined, undefined, JSON.stringify([job]));
    const html = await (await fetch(`${base}/specs`, )).text();
    expect(html).toContain(job.specFolder);
    // Labelled by its title: the provisional key says nothing to anyone.
    expect(html).toContain("A brand new spec");
  });

  // --- A job that goes create -> analyze in one run ---------
  //
  // No job's `steps` had ever carried a second entry after `create`
  // before this spec — the New spec page's phase table is what first
  // lets a reader ask for it. The runner's own mechanism (the "nothing
  // starts while a job is landing" gate in `runner.ts`, and `startOne`
  // re-reading `job.specFolder` fresh off the store every tick) is
  // generic and was never written FOR this case, but had never been
  // exercised by it either — so this proves it end to end rather than
  // trusting the reasoning.
  test("the step after create runs under the spec's real, renamed folder", async () => {
    const git = gitFor();
    const pending = legacyCreateJob("A new spec", { steps: ["create", "analyze"] });
    const { base, dir, results, job } = serverWithRunner(start, "aide-create-results-", git, {}, pending);
    expect(job.steps).toEqual(["create", "analyze"]);

    await settle(base, job.id, (j) => j.state === "running");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CREATE_RESULT));
    await settle(base, job.id, (j) => j.specFolder === "94-a-new-spec");
    // The landing's merge puts the folder on disk; until it is there, the
    // next step waits for it rather than starting into the runner's refusal.
    mkdirSync(join(dir, "root", "aide", "specs", "94-a-new-spec"), { recursive: true });
    writeFileSync(join(dir, "root", "aide", "specs", "94-a-new-spec", "1-description.md"), "# A new spec - Description\n");

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
