import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRootLock,
  type ServerOptions,
} from "../../src/serve/serve.ts";
import { type GitRunner } from "../../src/git/branch-status.ts";
import { statusSaying } from "../helpers/queue-server.ts";
import {
  TOKEN,
  JOB,
  specHead,
  specControls,
  openQuery,
  OPEN_81,
  setupQueueRoutesHarness,
} from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

/** A claude-usage that records the merges the dashboard reports to it
 *  (spec 158). The URL is never reached: what is under test is what the
 *  server decides to send, and to whom. */
function mergeEventSink(answer: () => Response | Promise<Response> = () => new Response("{}")) {
  const posted: Record<string, unknown>[] = [];
  const mergeEventFetch = (async (_url: unknown, init: unknown) => {
    posted.push(JSON.parse((init as RequestInit).body as string) as Record<string, unknown>);
    return answer();
  }) as unknown as typeof fetch;
  return { posted, mergeEventFetch, mergeEventUrl: "http://claude-usage.test/api/merge-event" };
}


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
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const SPECS_REPO = "/repos/aide-specs";
  const BRANCH = "aide/new-abc123de";

  /** A git that answers per repo, like the merge route's own harness.
   *  `conflicting` names the roots whose merge fails. */
  function gitFor(conflicting: string[] = []) {
    const calls: { dir: string; args: string[] }[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("merge -q --ff-only")) return { code: conflicting.includes(dir) ? 1 : 0, stdout: "" };
      if (a.startsWith("merge -q --no-edit")) return { code: conflicting.includes(dir) ? 1 : 0, stdout: "" };
      if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
      return { code: 0, stdout: "" };
    };
    return { run, calls };
  }

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

  /** A server whose runner spawns `/bin/true` and reads its results from a
   *  directory this suite owns — so a test can put the JSON there itself. */
  function serverWithRunner(
    git: { run: (dir: string, args: string[]) => Promise<unknown> },
    extra: Partial<ServerOptions> = {},
  ) {
    const results = mkdtempSync(join(tmpdir(), "aide-create-results-"));
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

  /** Wait for the runner's own 2-second tick to pick the result up and for
   *  the landing it triggers to finish. Polled, never slept blindly: what
   *  is under test is asynchronous by nature. */
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

  test("a successful create step is merged into every repo it pushed to, and renamed", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await createJob(base);
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CREATE_RESULT));
    await settle(base, job.id, (j) => j.specFolder === "94-a-new-spec");

    // The branch `aide-run-spec` REPORTED, never one re-derived from a
    // folder name that did not exist when the branch was made.
    const merges = git.calls.filter(
      (c) => c.args[0] === "merge" && c.args.includes(`refs/remotes/origin/${BRANCH}`),
    );
    expect(merges.length).toBeGreaterThan(0);
    expect(merges.every((c) => c.dir === SPECS_REPO)).toBe(true);
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args[0] === "push")).toBe(true);

    const landedJob = await settle(base, job.id, () => true);
    expect(landedJob.error).toBeFalsy();
    expect(landedJob.landing).toBeFalsy();
  });

  // The landing races the runs that pull the same checkout: 111 and 112
  // were both stranded by a first-try index.lock loss. A transient
  // failure is retried; only a merge that keeps failing is reported.
  test("a landing that fails once and then succeeds lands on the retry", async () => {
    let failures = 1;
    const inner = gitFor([]);
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
    const { base, results } = serverWithRunner(git as never);
    const job = await createJob(base);
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CREATE_RESULT));
    const landed = await settle(base, job.id, (j) => j.specFolder !== job.specFolder || !!j.error);
    expect(landed.error).toBeFalsy();
    expect(landed.specFolder).not.toBe(job.specFolder);
  });

  test("a landing that fails keeps the provisional key and says which repo and why", async () => {
    const git = gitFor([SPECS_REPO]);
    const { base, results } = serverWithRunner(git);
    const job = await createJob(base);
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CREATE_RESULT));
    const failed = await settle(base, job.id, (j) => !!j.error);

    expect(failed.specFolder).toBe(job.specFolder);
    expect(String(failed.error)).toContain(SPECS_REPO);
    expect(failed.landing).toBeFalsy();
    // Nothing half-merged is left for the next thing to trip over.
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args.join(" ") === "merge --abort")).toBe(true);
  });

  test("a landed spec is an ordinary row: analyze runnable, nothing left to merge", async () => {
    const git = gitFor();
    const { base, dir, results } = serverWithRunner(git);
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

  // Spec 158, criterion 6. A create job's key is provisional until the
  // run reports the folder it actually made, and the job record is only
  // renamed AFTER every repo has been landed — so an event built from
  // `job.specFolder` would name a spec nobody can look up. It reads the
  // outcome the landing itself is about to write.
  test("the merge event for a create landing names the renamed folder, not the provisional key", async () => {
    const git = gitFor();
    const sink = mergeEventSink();
    const { base, results } = serverWithRunner(git, sink);
    const job = await createJob(base);
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CREATE_RESULT));
    await settle(base, job.id, (j) => j.specFolder === "94-a-new-spec");

    expect(sink.posted.length).toBe(1);
    expect(sink.posted[0]).toMatchObject({
      project: "aide",
      specFolder: "94-a-new-spec",
      branch: BRANCH,
      repoRoot: SPECS_REPO,
      step: "create",
      jobId: job.id,
    });
    expect(sink.posted[0].specFolder).not.toBe(job.specFolder);
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
});

// Spec 136: an archive run's whole diff is two markdown changes in the
// specs repo — the date stamped into 4-status.md and the folder moved
// into `archive/` — and, like every other step, it leaves them on a
// branch. The list reads the main checkout, so the spec stayed in the
// active list and the row asked to be merged: the step that ENDS a spec
// ended by handing back a task (133, archived twice for exactly this).
// So archive lands its own work, the way `create` has since spec 93 —
// the same helper, the same per-repo report, the same visible refusal
// when a merge genuinely cannot be made.
describe("landing an archived spec (spec 136)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const SPECS_REPO = "/repos/aide-specs";
  const SPEC = "81-queue-and-runner";
  const BRANCH = `aide/${SPEC}`;

  /** A git that answers per repo. `conflicting` names the roots whose
   *  merge fails both ways; `needsRealMerge` names the ones where the
   *  base has moved on — ff-only refuses, a real merge commit works;
   *  `gone` names the ones where origin has no such branch left, which
   *  `ls-remote --exit-code` reports as code 2 (spec 153). */
  function gitFor({
    conflicting = [] as string[],
    needsRealMerge = [] as string[],
    gone = [] as string[],
  } = {}) {
    const calls: { dir: string; args: string[] }[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("ls-remote") && gone.includes(dir)) return { code: 2, stdout: "" };
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("merge -q --ff-only")) {
        return { code: conflicting.includes(dir) || needsRealMerge.includes(dir) ? 1 : 0, stdout: "" };
      }
      if (a.startsWith("merge -q --no-edit")) return { code: conflicting.includes(dir) ? 1 : 0, stdout: "" };
      if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
      return { code: 0, stdout: "" };
    };
    return { run, calls };
  }

  /** The result `aide-run-spec` writes for an archive step that moved the
   *  folder and pushed the specs repo. No `specFolder`: that field is
   *  create's, and an archive step reports none. */
  const ARCHIVE_RESULT = {
    ok: true,
    exitCode: 0,
    costUsd: 0.2,
    costMeasured: true,
    terminalReason: "completed",
    branch: BRANCH,
    branchUrls: [{ root: SPECS_REPO, url: "https://example.test/aide-specs" }],
    repos: [],
  };

  function serverWithRunner(
    git: { run: (dir: string, args: string[]) => Promise<unknown> },
    extra: Partial<ServerOptions> = {},
  ) {
    const results = mkdtempSync(join(tmpdir(), "aide-archive-results-"));
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

  /** Queue one step for the harness's own spec, straight through — no
   *  gate, so the run reaches `onStepDone` without a press. */
  async function runStep(base: string, step: string): Promise<{ id: string; specFolder: string }> {
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: [step] }),
      })
    ).json()) as { job: { id: string; specFolder: string } };
    return made.job;
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

  const merges = (calls: { dir: string; args: string[] }[]) =>
    calls.filter((c) => c.args[0] === "merge" && c.args.includes(`refs/remotes/origin/${BRANCH}`));

  // Criterion 1. This archive job is the FIRST the queue has ever run
  // for this spec, so `branchesFor()` — read synchronously inside the
  // same call stack, before the runner has written this step's own
  // record — would answer with nothing. The landing reads the outcome
  // in hand instead, which has no such timing to get wrong.
  test("a successful archive step is merged and pushed with no Merge press", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "archive");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ARCHIVE_RESULT));
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(merges(git.calls).length).toBeGreaterThan(0);
    expect(merges(git.calls).every((c) => c.dir === SPECS_REPO)).toBe(true);
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args[0] === "push")).toBe(true);
    // Landed, so the row stops advertising a branch to merge.
    expect(landed.branchUrls).toEqual([]);
  });

  // Criterion 2. Main moves while a job runs — 124, 133 and five older
  // specs were each refused with "cannot fast-forward" for that alone.
  // A real merge commit is the answer, not a failure to report.
  test("a base that moved is a real merge commit, not a refusal", async () => {
    const git = gitFor({ needsRealMerge: [SPECS_REPO] });
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "archive");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ARCHIVE_RESULT));
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(git.calls.some((c) => c.args.join(" ").startsWith("merge -q --no-edit"))).toBe(true);
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args[0] === "push")).toBe(true);
    expect(git.calls.some((c) => c.args.join(" ") === "merge --abort")).toBe(false);
  });

  // Criterion 3. The fallback is not being removed: a merge that cannot
  // be made says which repo and why, keeps the branch on the row, and
  // leaves the spec where it was.
  test("a genuine conflict keeps the branch, names the repo, and reports it", async () => {
    const git = gitFor({ conflicting: [SPECS_REPO] });
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "archive");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ARCHIVE_RESULT));
    const failed = await settle(base, job.id, (j) => !!j.error);

    expect(String(failed.error)).toContain(SPECS_REPO);
    expect(String(failed.error)).toContain("conflict");
    expect(failed.landing).toBeFalsy();
    // Nothing half-merged is left behind, and the branch is still there
    // to press Merge (or resolve) against.
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args.join(" ") === "merge --abort")).toBe(true);
    expect(failed.branchUrls).toEqual([{ root: SPECS_REPO, url: "https://example.test/aide-specs" }]);
    // The spec is still in the active list, exactly as it was.
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(specHead(html, SPEC)).not.toBe("");
  });

  // Criterion 4. A run that pushed nothing has nothing to land. Silence
  // is the right answer — create says "no pushed branch to land it
  // from" because for create that IS the failure; for archive a HEAD
  // that never moved is an ordinary outcome.
  test("an archive step that pushed nothing is a no-op, not an error", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "archive");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({ ...ARCHIVE_RESULT, branch: undefined, branchUrls: [] }),
    );
    const done = await settle(base, job.id, (j) => j.state === "done");

    expect(done.error).toBeFalsy();
    expect(merges(git.calls)).toEqual([]);
  });

  // --- spec 153: a branch that is already gone is not a failed landing ------
  //
  // The archive landing looks back through the whole history of branches
  // this spec's steps pushed (`branchesFor`), because `implement` never
  // lands its own and archive is what finally does. Since spec 149 a
  // `resolve` step lands AND DELETES its own branch, so that history
  // names a branch that is provably gone by the time archive reaches it.
  // Job 15932abc (2026-08-21) was the first: `ok: true`, archived, and
  // an error on the row saying "there is nothing left to merge".
  test("a code branch already merged and deleted is nothing to land, not a failure", async () => {
    const CODE_REPO = "/repos/aide";
    const git = gitFor({ gone: [CODE_REPO] });
    const { base, results } = serverWithRunner(git, { queueProjectRoot: "/repos" });
    const job = await runStep(base, "archive");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({
        ...ARCHIVE_RESULT,
        branchUrls: [
          { root: SPECS_REPO, url: "https://example.test/aide-specs" },
          { root: CODE_REPO, url: "https://example.test/aide" },
        ],
      }),
    );
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(landed.errorReason).toBeFalsy();
    // The specs repo in the same landing still merges and pushes.
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args[0] === "push")).toBe(true);
    // And nothing was merged in the repo whose branch is gone.
    expect(merges(git.calls).some((c) => c.dir === CODE_REPO)).toBe(false);
  });

  // The guard against over-fixing: "gone" is excluded from the report,
  // not every refusal beside it.
  test("a gone branch beside a genuine conflict still reports the conflict", async () => {
    const CODE_REPO = "/repos/aide";
    const git = gitFor({ gone: [CODE_REPO], conflicting: [SPECS_REPO] });
    const { base, results } = serverWithRunner(git, { queueProjectRoot: "/repos" });
    const job = await runStep(base, "archive");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({
        ...ARCHIVE_RESULT,
        branchUrls: [
          { root: SPECS_REPO, url: "https://example.test/aide-specs" },
          { root: CODE_REPO, url: "https://example.test/aide" },
        ],
      }),
    );
    const failed = await settle(base, job.id, (j) => !!j.error);

    expect(String(failed.error)).toContain(SPECS_REPO);
    expect(String(failed.error)).toContain("conflict");
    // The gone repo contributes nothing to the sentence a person reads.
    expect(String(failed.error)).not.toContain("nothing left to merge");
    expect(failed.errorReason).toBe("conflict");
    // Two repos, each running the landing's three tries with a pause
    // between them, so this one is genuinely slower than the default.
  }, 20000);

  // Criterion 6. Nobody is watching an automatic landing to press the
  // button again, and this one races the runs that pull the same
  // checkout — 111 and 112 were both stranded by a first-try loss.
  test("a landing that loses the index.lock race once lands on the retry", async () => {
    let failures = 1;
    const inner = gitFor();
    const git = {
      calls: inner.calls,
      run: (dir: string, args: string[]) => {
        if (args.join(" ").startsWith("merge -q --ff-only") && dir === SPECS_REPO && failures > 0) {
          failures -= 1;
          return Promise.resolve({ code: 1, stdout: "", stderr: "index.lock" });
        }
        return inner.run(dir, args);
      },
    };
    const { base, results } = serverWithRunner(git as never);
    const job = await runStep(base, "archive");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ARCHIVE_RESULT));
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args[0] === "push")).toBe(true);
  });

  // Criterion 7. Merged is not deployed, and the manual route runs the
  // project's install for exactly that reason — but an archive run
  // writes two markdown changes in the SPECS repo and moves no code, so
  // there is nothing on this machine to reinstall.
  test("landing an archive runs no install command", async () => {
    // A REAL directory for the specs repo, carrying an install command
    // of its own: a landing that reached for `installAfterMerge` at all
    // would find it and run it, which is what this test is here to
    // notice. `/repos/aide-specs` is a name to git and nothing else, so
    // against that path the question cannot be asked.
    const specsRepo = mkdtempSync(join(tmpdir(), "aide-specs-repo-"));
    ownDirs.push(specsRepo);
    const marker = join(specsRepo, "installed");
    mkdirSync(join(specsRepo, ".aide"), { recursive: true });
    writeFileSync(join(specsRepo, ".aide", "config"), `AIDE_INSTALL_CMD=/usr/bin/touch ${marker}\n`);

    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "archive");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({ ...ARCHIVE_RESULT, branchUrls: [{ root: specsRepo, url: "https://example.test/s" }] }),
    );
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(git.calls.some((c) => c.dir === specsRepo && c.args[0] === "push")).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  // Criterion 8. A run that DECLINES to archive writes a reason into
  // 4-status.md and nothing else. That reason is read off disk in the
  // main checkout, so it too was invisible until someone merged — and
  // the page caches its scan for five seconds, so the landing has to
  // clear it or the very next request still shows the old answer.
  test("a held-back note is landed and shows on the row without a merge press", async () => {
    const git = gitFor();
    const { base, dir, results } = serverWithRunner(git);
    const specDir = join(dir, "root", "aide", "specs", SPEC);
    // The page is read once first, so the scan is cached WITHOUT the note.
    const before = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(before).not.toContain("archive held back");

    // What the merge brings into the main checkout.
    writeFileSync(
      join(specDir, "4-status.md"),
      statusSaying(
        ["create", "analyze", "implement"],
        "\n## Archive held back\n\n- the implementation was reverted\n",
      ),
    );
    const job = await runStep(base, "archive");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ARCHIVE_RESULT));
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);
    expect(landed.error).toBeFalsy();

    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain("archive held back — the implementation was reverted");
  });

  // Criterion 5, as spec 149 leaves it. `analyze` lands itself now too,
  // so the steps that still land nothing are `implement` — whose pushed
  // branch IS the place a person tests the code — and the two that
  // belong to no spec's branch at all.
  test("no other step lands itself — implement's branch stays open", async () => {
    const steps = ["implement", "explore", "manifest"];
    const checked = await Promise.all(
      steps.map(async (step) => {
        const git = gitFor();
        const { base, results } = serverWithRunner(git);
        const job = await runStep(base, step);
        writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ARCHIVE_RESULT));
        const done = await settle(base, job.id, (j) => j.state === "done");
        return { step, done, merged: merges(git.calls).length };
      }),
    );
    for (const { step, done, merged } of checked) {
      expect(`${step}: ${merged}`).toBe(`${step}: 0`);
      expect(`${step}: ${!!done.landing}`).toBe(`${step}: false`);
      // The branch is still on the row, waiting for the Merge button.
      expect(`${step}: ${JSON.stringify(done.branchUrls)}`).toBe(
        `${step}: ${JSON.stringify(ARCHIVE_RESULT.branchUrls)}`,
      );
    }
  });
});

// --- spec 187: a stopped step keeps its work --------------------------------
//
// A step whose clock runs out still commits what it wrote — `aide-run-spec`'s
// commit loop runs on every path — and still pushes it, because the push is
// gated on the push mode and not on `ok`. Landing was the one thing gated on
// `ok`, so that work sat on a branch nothing on the page mentioned: spec 184
// stopped on 2026-08-22 with a complete analysis, and the only way to learn
// that was to check the branch out by hand.
//
// What lands is decided by what the run TOUCHED, never by which step it was:
// a run that moved a code root's HEAD is left alone, exactly as a failed run
// is. That way there is no second list of "which steps are safe" to keep in
// step with the first.
describe("landing a stopped step's specs-only work (spec 187)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const SPECS_REPO = "/repos/aide-specs";
  const CODE_REPO = "/repos/aide";
  const SPEC = "81-queue-and-runner";
  const BRANCH = `aide/${SPEC}`;

  /** A git that answers per repo, as the landing suites above do. */
  function gitFor(conflicting: string[] = []) {
    const calls: { dir: string; args: string[] }[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("merge -q --ff-only")) return { code: conflicting.includes(dir) ? 1 : 0, stdout: "" };
      if (a.startsWith("merge -q --no-edit")) return { code: conflicting.includes(dir) ? 1 : 0, stdout: "" };
      if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
      return { code: 0, stdout: "" };
    };
    return { run, calls };
  }

  /** The result `aide-run-spec` writes for a step SIGTERMed at its own
   *  `--timeout-sec` deadline: not ok, no exit code of its own, and the
   *  branch it had already committed and pushed to. */
  const STOPPED_RESULT = {
    ok: false,
    exitCode: 143,
    costUsd: 0.6,
    costMeasured: true,
    terminalReason: "timeout",
    branch: BRANCH,
    branchUrls: [{ root: SPECS_REPO, url: "https://example.test/aide-specs" }],
    repos: [],
  };

  function serverWithRunner(
    git: { run: (dir: string, args: string[]) => Promise<unknown> },
    extra: Partial<ServerOptions> = {},
  ) {
    const results = mkdtempSync(join(tmpdir(), "aide-stopped-results-"));
    ownDirs.push(results);
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: git.run as never,
      queueRunnerBin: "/usr/bin/true",
      queueResultDir: results,
      queueProjectRoot: "/repos",
      ...extra,
    });
    return { base, dir, results };
  }

  async function runStep(base: string, step: string): Promise<{ id: string; specFolder: string }> {
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: [step] }),
      })
    ).json()) as { job: { id: string; specFolder: string } };
    return made.job;
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

  const mergesOf = (calls: { dir: string; args: string[] }[], branch = BRANCH) =>
    calls.filter((c) => c.args[0] === "merge" && c.args.includes(`refs/remotes/origin/${branch}`));

  // Criterion 1. The work is on the branch already; the only thing that
  // kept it off the page was the `ok` gate in front of the landing.
  test("a stopped analyze step that pushed only the specs repo is merged", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "analyze");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(STOPPED_RESULT));
    const landed = await settle(base, job.id, (j) => j.state === "stopped" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(mergesOf(git.calls).length).toBeGreaterThan(0);
    expect(mergesOf(git.calls).every((c) => c.dir === SPECS_REPO)).toBe(true);
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args[0] === "push")).toBe(true);
    // Landed, so the row stops advertising a branch to compare.
    expect(landed.branchUrls).toEqual([]);
    // It still stopped: landing the work does not make the step a success.
    expect(landed.stopReason).toBe("timeout");
  });

  // Criterion 1's step-agnostic reach. `create` is not on any list here —
  // what decides is that nothing outside the specs repo moved. Its job row
  // keeps its provisional key (a stopped create reports no `specFolder`),
  // which is accepted: the folder itself reaches the list, which reads the
  // main checkout off disk.
  test("a stopped create step's specs-repo work is landed too", async () => {
    const CREATE_BRANCH = "aide/new-abc123de";
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const made = (await (
      await fetch(`${base}/api/queue/create`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", title: "A half-written spec", description: "Do the thing" }),
      })
    ).json()) as { job: { id: string; specFolder: string } };
    writeFileSync(
      join(results, `${made.job.id}.json`),
      JSON.stringify({ ...STOPPED_RESULT, branch: CREATE_BRANCH }),
    );
    const landed = await settle(base, made.job.id, (j) => j.state === "stopped" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(mergesOf(git.calls, CREATE_BRANCH).length).toBeGreaterThan(0);
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args[0] === "push")).toBe(true);
  });

  // Criterion 2. The description's third requirement, and the reason the
  // check reads repos rather than step names: code stays on its branch,
  // where a person tests it, however the run ended.
  test("a stopped step that also pushed the project repo lands nothing", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "implement");
    const pushed = [
      { root: SPECS_REPO, url: "https://example.test/aide-specs" },
      { root: CODE_REPO, url: "https://example.test/aide" },
    ];
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify({ ...STOPPED_RESULT, branchUrls: pushed }));
    const stopped = await settle(base, job.id, (j) => j.state === "stopped");

    expect(stopped.landing).toBeFalsy();
    // Not "the code repo was skipped" — no repo in this outcome is merged,
    // the specs one included.
    expect(mergesOf(git.calls)).toEqual([]);
    expect(stopped.branchUrls).toEqual(pushed);
  });

  // The same, for a run whose ONLY branch is a code branch.
  test("a stopped step that pushed only the project repo lands nothing", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "implement");
    const pushed = [{ root: CODE_REPO, url: "https://example.test/aide" }];
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify({ ...STOPPED_RESULT, branchUrls: pushed }));
    const stopped = await settle(base, job.id, (j) => j.state === "stopped");

    expect(stopped.landing).toBeFalsy();
    expect(mergesOf(git.calls)).toEqual([]);
    expect(stopped.branchUrls).toEqual(pushed);
  });

  // Criterion 3. A run that pushed nothing has nothing to land, and
  // silence is the whole of the right answer — no error on the row.
  test("a stopped step that pushed nothing is a no-op, not an error", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "analyze");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({ ...STOPPED_RESULT, branch: undefined, branchUrls: [] }),
    );
    const stopped = await settle(base, job.id, (j) => j.state === "stopped");

    expect(stopped.error).toBeFalsy();
    expect(stopped.landing).toBeFalsy();
    expect(mergesOf(git.calls)).toEqual([]);
  });

  // Criterion 4. Scoped to the wall clock. A cost cap can stop a step
  // mid-sentence with no commit boundary of its own, and a CLI error is
  // not a stop at all — neither is landed.
  test("a stop for a reason other than the clock lands nothing", async () => {
    for (const reason of ["budget", "cli-error"]) {
      const git = gitFor();
      const { base, results } = serverWithRunner(git);
      const job = await runStep(base, "analyze");
      writeFileSync(
        join(results, `${job.id}.json`),
        JSON.stringify({ ...STOPPED_RESULT, terminalReason: reason }),
      );
      const ended = await settle(base, job.id, (j) => j.state === "stopped" || j.state === "failed");

      expect(`${reason}: ${mergesOf(git.calls).length}`).toBe(`${reason}: 0`);
      expect(`${reason}: ${!!ended.landing}`).toBe(`${reason}: false`);
      expect(`${reason}: ${JSON.stringify(ended.branchUrls)}`).toBe(
        `${reason}: ${JSON.stringify(STOPPED_RESULT.branchUrls)}`,
      );
    }
  });

  test("a provider-limit stop lands specs-only work through the safe path", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "analyze");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({ ...STOPPED_RESULT, terminalReason: "provider-limit" }),
    );
    const stopped = await settle(base, job.id, (j) => j.state === "stopped");
    await settle(base, job.id, (j) => !j.landing);
    expect(stopped.stopReason as string).toBe("provider-limit");
    expect(mergesOf(git.calls)).not.toEqual([]);
  });

  test("a provider-limit stop leaves project changes on the branch", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "implement");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({
        ...STOPPED_RESULT,
        terminalReason: "provider-limit",
        branchUrls: [{ root: CODE_REPO, url: "https://example.test/aide" }],
      }),
    );
    const stopped = await settle(base, job.id, (j) => j.state === "stopped");
    expect(stopped.landing).toBeFalsy();
    expect(mergesOf(git.calls)).toEqual([]);
  });
});

// --- spec 149: merging happens inside the steps, never by hand --------------
//
// A queue job that ran analyze, implement and archive in one go ended
// with the spec archived and the code still on a branch, waiting for
// someone to press Merge; the same steps run one at a time piled
// "ready to merge" buttons on the row for the specs repo and one for
// the code. None of those buttons exist any more. Every step lands the work
// it produced, and `implement` is the one exception ON PURPOSE: its branch
// is where a person tests the code, by leaving `archive` unticked.
//
// `archive` is therefore the one step that sends CODE to a default branch —
// so it is the one landing that has to look past its own outcome (the code
// branch moved during implement, not during archive) and the one that has
// to install afterwards, exactly as the Merge button did.
describe("every step lands its own work (spec 149)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const SPEC = "81-queue-and-runner";
  const BRANCH = `aide/${SPEC}`;

  /** A projects root this suite owns, so `projectDir("aide")` is a path
   *  the test can name — and can hang an `AIDE_INSTALL_CMD` off. The
   *  shared harness leaves `queueProjectRoot` unset, which resolves the
   *  project's checkout to a bare relative name. */
  function own(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    ownDirs.push(dir);
    return dir;
  }

  /** A git that answers per repo. `conflicting` names the roots whose
   *  merge fails both ways. `slow` delays the ff-only merge, so two
   *  landings on one root can be caught overlapping.
   *
   *  `openOn` (spec 193) names the roots whose ORIGIN still has the
   *  spec branch, and a merge that succeeds in a root takes it out of
   *  that set — which is what `mergeBranchIntoDefault` really does, by
   *  deleting the branch on origin once it has landed. `lsRemoteCode`
   *  is what a root that cannot be asked answers: an unreachable host,
   *  not an empty list. */
  function gitFor({
    conflicting = [] as string[],
    slow = null as null | (() => Promise<void>),
    openOn = [] as string[],
    lsRemoteCode = 0,
  } = {}) {
    const calls: { dir: string; args: string[] }[] = [];
    const open = new Set(openOn);
    const merged = (dir: string): { code: number; stdout: string } => {
      if (conflicting.includes(dir)) return { code: 1, stdout: "" };
      open.delete(dir);
      return { code: 0, stdout: "" };
    };
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("ls-remote --heads origin refs/heads/aide/*")) {
        return {
          code: lsRemoteCode,
          stdout: lsRemoteCode === 0 && open.has(dir) ? `a3f9c21\trefs/heads/${BRANCH}\n` : "",
        };
      }
      if (a.startsWith("merge -q --ff-only")) {
        if (slow) await slow();
        return merged(dir);
      }
      if (a.startsWith("merge -q --no-edit")) return merged(dir);
      if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
      return { code: 0, stdout: "" };
    };
    return { run, calls };
  }

  /** A discoverable project root with a real directory for the project's
   *  own checkout, plus the specs repo the run pushes to.
   *
   *  `archiveSpec` is what the specs-root merge brings into the main
   *  checkout (spec 193): the folder move the archive run committed on
   *  its branch. Until it is called the spec is LIVE on disk, which is
   *  why an archive-landing test that never calls it steps straight
   *  past the archived filter and can assert nothing about it. */
  function repos(dir: string): {
    root: string;
    project: string;
    specs: string;
    archiveSpec: () => void;
  } {
    const projectsRoot = join(dir, "root");
    const project = join(projectsRoot, "aide");
    const specs = join(dir, "aide-specs");
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\n");
    mkdirSync(join(project, "specs", SPEC), { recursive: true });
    writeFileSync(join(project, "specs", SPEC, "1-description.md"), "# 81 - Description\n");
    writeFileSync(join(project, "specs", SPEC, "4-status.md"), statusSaying(["create", "analyze"]));
    mkdirSync(specs, { recursive: true });
    return {
      root: projectsRoot,
      project,
      specs,
      archiveSpec: () => {
        mkdirSync(join(project, "specs", "archive"), { recursive: true });
        renameSync(join(project, "specs", SPEC), join(project, "specs", "archive", SPEC));
      },
    };
  }

  /** The install the project runs once its code has landed — a `touch`,
   *  so the test can ask whether it ran by asking the filesystem. */
  function installs(project: string): string {
    const marker = join(project, "installed");
    writeFileSync(join(project, ".aide", "config"), `AIDE_INSTALL_CMD=/usr/bin/touch ${marker}\n`);
    return marker;
  }

  function serverWith(
    dir: string,
    paths: { root: string },
    git: { run: (dir: string, args: string[]) => Promise<unknown> },
    extra: Partial<ServerOptions> = {},
  ): { base: string } {
    const results = join(dir, "jobs");
    mkdirSync(results, { recursive: true });
    return harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        gitRun: git.run as never,
        queueRunnerBin: "/usr/bin/true",
        queueResultDir: results,
        ...extra,
      },
    });
  }

  const resultDir = (dir: string) => join(dir, "jobs");

  async function runStep(base: string, step: string): Promise<{ id: string }> {
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: [step] }),
      })
    ).json()) as { job: { id: string } };
    return made.job;
  }

  async function settle(
    base: string,
    id: string,
    done: (job: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    for (let n = 0; n < 100; n++) {
      const body = (await (await fetch(`${base}/api/queue/${id}`, { headers: AUTH })).json()) as {
        job: Record<string, unknown>;
      };
      if (done(body.job)) return body.job;
      await Bun.sleep(50);
    }
    throw new Error("the job never settled");
  }

  const merges = (calls: { dir: string; args: string[] }[], root?: string) =>
    calls.filter(
      (c) =>
        c.args[0] === "merge" &&
        c.args.includes(`refs/remotes/origin/${BRANCH}`) &&
        (root === undefined || c.dir === root),
    );

  const result = (over: Record<string, unknown> = {}) => ({
    ok: true,
    exitCode: 0,
    costUsd: 0.2,
    costMeasured: true,
    terminalReason: "completed",
    branch: BRANCH,
    repos: [],
    ...over,
  });

  /** Run one step to completion with the result `aide-run-spec` would
   *  have written for it, and hand back the job as the queue left it. */
  async function stepWithResult(
    base: string,
    dir: string,
    step: string,
    over: Record<string, unknown>,
    settled: (job: Record<string, unknown>) => boolean = (j) => j.state === "done" && !j.landing,
  ): Promise<Record<string, unknown>> {
    const job = await runStep(base, step);
    writeFileSync(join(resultDir(dir), `${job.id}.json`), JSON.stringify(result(over)));
    return settle(base, job.id, settled);
  }

  // Criteria 1 and 2. The argument that made `create` and `archive` land
  // themselves holds word for word here: analyze writes markdown in the
  // specs repo and nothing else, so there is no diff for a person to
  // weigh and nothing that reaches the serving host.
  test.each(["analyze"])(
    "a finished %s step lands its own branch, with no press and no HTTP request",
    async (step) => {
      const dir = own(`aide-149-${step}-`);
      const paths = repos(dir);
      const git = gitFor();
      const { base } = serverWith(dir, paths, git);

      const landed = await stepWithResult(base, dir, step, {
        branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
      });

      expect(landed.error).toBeFalsy();
      expect(merges(git.calls, paths.specs).length).toBeGreaterThan(0);
      expect(git.calls.some((c) => c.dir === paths.specs && c.args[0] === "push")).toBe(true);
      // Landed, so the row stops advertising a branch at all.
      expect(landed.branchUrls).toEqual([]);
    },
  );

  // Criterion 3. The one step that deliberately does not land. The code
  // stays on `aide/<spec>`, which is where a person tests it — by
  // leaving `archive` unticked. The worktree is gone when the run ends,
  // so the branch on origin is what remains.
  test("a finished implement step merges nothing and leaves its branch open", async () => {
    const dir = own("aide-149-implement-");
    const paths = repos(dir);
    const git = gitFor();
    const { base } = serverWith(dir, paths, git);
    const marker = installs(paths.project);

    const branchUrls = [
      { root: paths.project, url: "https://example.test/aide" },
      { root: paths.specs, url: "https://example.test/aide-specs" },
    ];
    const done = await stepWithResult(base, dir, "implement", { branchUrls }, (j) => j.state === "done");

    expect(merges(git.calls)).toEqual([]);
    expect(done.landing).toBeFalsy();
    expect(done.branchUrls).toEqual(branchUrls);
    expect(existsSync(marker)).toBe(false);
  });

  // Criterion 4. The one landing that sends CODE to a default branch —
  // and the reason it cannot read its own outcome alone. The code branch
  // moved during IMPLEMENT; archive's own run may touch the project
  // checkout without moving its HEAD at all, so the project root need
  // never appear in archive's `branchUrls`. `queue.branchesFor` is the
  // record that still has it.
  test("archive lands the code branch an earlier implement left, and installs it", async () => {
    const dir = own("aide-149-archive-code-");
    const paths = repos(dir);
    const git = gitFor();
    const { base } = serverWith(dir, paths, git);
    const marker = installs(paths.project);

    // Implement first: it lands nothing, and its record is what carries
    // the project's branch forward.
    await stepWithResult(
      base,
      dir,
      "implement",
      {
        branchUrls: [
          { root: paths.project, url: "https://example.test/aide" },
          { root: paths.specs, url: "https://example.test/aide-specs" },
        ],
      },
      (j) => j.state === "done",
    );

    // Archive's own run reports the specs repo alone.
    const landed = await stepWithResult(base, dir, "archive", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(landed.error).toBeFalsy();
    expect(merges(git.calls, paths.project).length).toBeGreaterThan(0);
    expect(merges(git.calls, paths.specs).length).toBeGreaterThan(0);
    // Merged is not deployed: for a tool that lives in `~/.local/bin`,
    // the default branch moving changes nothing on the machine until the
    // install runs. That is spec 92's bug, and the Merge button ran the
    // install for exactly this reason.
    for (let i = 0; i < 40 && !existsSync(marker); i++) await Bun.sleep(25);
    expect(existsSync(marker)).toBe(true);
  });

  // Criterion 5. A code merge that cannot be made stops the step: nothing
  // is left half-merged, the reason names the repo, and the spec stays in
  // the active list. `errorReason` is what makes the way out survive —
  // there is no browser attached to an automatic landing, so the one-shot
  // redirect the Merge button used cannot carry it.
  test("an archive landing that conflicts records errorReason and archives nothing", async () => {
    const dir = own("aide-149-archive-conflict-");
    const paths = repos(dir);
    // Plan first, code last: the specs merge lands the folder move, and
    // only then does the code merge conflict. So the spec IS archived on
    // disk by the time the row is asked for — which is the whole reason
    // the row needed spec 193 to survive at all.
    const git = gitFor({ conflicting: [paths.project], openOn: [paths.project] });
    const { base } = serverWith(dir, paths, git);
    const marker = installs(paths.project);

    await stepWithResult(
      base,
      dir,
      "implement",
      { branchUrls: [{ root: paths.project, url: "https://example.test/aide" }] },
      (j) => j.state === "done",
    );
    const archiving = await runStep(base, "archive");
    paths.archiveSpec();
    writeFileSync(
      join(resultDir(dir), `${archiving.id}.json`),
      JSON.stringify(result({ branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }] })),
    );
    const failed = await settle(base, archiving.id, (j) => !!j.error);

    expect(String(failed.error)).toContain(paths.project);
    expect(String(failed.error)).toContain("conflict");
    expect(failed.errorReason).toBe("conflict");
    expect(failed.landing).toBeFalsy();
    // Nothing half-merged, and nothing deployed from a merge that never
    // happened.
    expect(git.calls.some((c) => c.dir === paths.project && c.args.join(" ") === "merge --abort")).toBe(true);
    expect(existsSync(marker)).toBe(false);
    // Still in the active list, with its branch, exactly as it was.
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(specHead(html, SPEC)).not.toBe("");
  }, 20000);

  // Criterion 6. A middle-of-the-workflow step lands what its OWN run
  // reports and nothing else; reading `branchesFor` history instead
  // would let a step that touched only the specs repo drag an
  // unarchived implement's code onto the default branch as a side
  // effect. (`resolve` was the step this was written for, until spec
  // 171 retired it, and `review-plan` was the other, until spec 181
  // folded it into analyze; the rule it proves belongs to
  // `landStepBranch`, which still lands `analyze`.)
  test("analyze lands the repos its own run reports, and installs a code root among them", async () => {
    const dir = own("aide-149-analyze-lands-");
    const paths = repos(dir);
    const git = gitFor();
    const { base } = serverWith(dir, paths, git);
    const marker = installs(paths.project);

    const landed = await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.project, url: "https://example.test/aide" }],
    });

    expect(landed.error).toBeFalsy();
    expect(merges(git.calls, paths.project).length).toBeGreaterThan(0);
    expect(landed.branchUrls).toEqual([]);
    for (let i = 0; i < 40 && !existsSync(marker); i++) await Bun.sleep(25);
    expect(existsSync(marker)).toBe(true);
  });

  // The other half of criterion 6, and the whole of the risk this spec
  // accepted knowingly: a step that touched only the specs repo must
  // not reach back into the queue's history and land the code an
  // earlier implement left open.
  test("analyze does not land an unarchived implement's code branch", async () => {
    const dir = own("aide-149-analyze-scope-");
    const paths = repos(dir);
    const git = gitFor();
    const { base } = serverWith(dir, paths, git);

    await stepWithResult(
      base,
      dir,
      "implement",
      { branchUrls: [{ root: paths.project, url: "https://example.test/aide" }] },
      (j) => j.state === "done",
    );
    await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(merges(git.calls, paths.specs).length).toBeGreaterThan(0);
    expect(merges(git.calls, paths.project)).toEqual([]);
  });

  // Criterion 7, as spec 171 leaves it. The reason is still stored on
  // the job and still read from there on any later request — a landing
  // has no browser to redirect a query string to. What is gone is the
  // control it used to draw: `archive` resolves a conflict itself now,
  // so a conflict that reaches the page is one no press would settle.
  test("a stored conflict draws no control on a fresh request (spec 171)", async () => {
    const dir = own("aide-171-conflict-offer-");
    const paths = repos(dir);
    const git = gitFor({ conflicting: [paths.specs] });
    const { base } = serverWith(dir, paths, git);

    await stepWithResult(
      base,
      dir,
      "analyze",
      { branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }] },
      (j) => !!j.error,
    );

    const url = `${base}/?${OPEN_81}`;
    const html = await (await fetch(url, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).not.toContain("resolveform");
    expect(specControls(html, SPEC)).not.toContain('value="resolve"');
    // The failure itself is still on the row, and still names the repo
    // the reader has to go and look at.
    expect(specControls(html, SPEC)).not.toBe("");
  });

  // Criterion 8. Both routes are gone, not merely unreachable from the
  // page: the actions they offered are what this whole spec removes.
  test.each(["merge", "approve"])("POST /api/queue/<id>/%s is not a route any more", async (verb) => {
    const dir = own(`aide-149-route-${verb}-`);
    const paths = repos(dir);
    const { base } = serverWith(dir, paths, gitFor());
    const job = await runStep(base, "analyze");

    const res = await fetch(`${base}/api/queue/${job.id}/${verb}`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(404);
    // Cancel is untouched — it is the one thing on that route that was
    // never about merging.
    const cancel = await fetch(`${base}/api/queue/${job.id}/cancel`, { method: "POST", headers: AUTH });
    expect(cancel.status).toBe(200);
  });

  // Criterion 9. No form on the page could ever set a gate, and the
  // three jobs that ever had one were posted as JSON by hand. A request
  // that still names it is accepted and the field ignored, like every
  // other unknown key — and no job can reach the state it produced.
  test("a POST naming gateAfter is accepted, and the job runs straight through", async () => {
    const dir = own("aide-149-gate-");
    const paths = repos(dir);
    const { base } = serverWith(dir, paths, gitFor());
    const made = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({
        project: "aide",
        specFolder: SPEC,
        steps: ["analyze", "implement"],
        gateAfter: ["analyze"],
      }),
    });
    expect(made.status).toBe(200);
    const body = (await made.json()) as { job: Record<string, unknown> };
    expect("gateAfter" in body.job).toBe(false);
    expect(body.job.state).not.toBe("awaiting-approval");
  });

  // --- spec 158: a merge is an event claude-usage can see ---------------
  //
  // The dashboard merges in its own Bun process, so nothing writes a
  // transcript for claude-usage to read a merge out of. It has to say
  // what it did — for EVERY repo it lands, not only the code roots
  // `installAfterMerge` cares about, because the spec-markdown merges
  // an `analyze` makes are exactly the ones the ledger
  // is missing today.

  // Criterion 1. Every other test in this file is the other half of this
  // proof: none of them configures a URL, and none of them would issue a
  // request even with a live fetch in the harness.
  test("no url configured means no request, whatever lands", async () => {
    const dir = own("aide-158-inert-");
    const paths = repos(dir);
    const git = gitFor();
    const sink = mergeEventSink();
    const { base } = serverWith(dir, paths, git, { mergeEventFetch: sink.mergeEventFetch });

    const landed = await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(landed.error).toBeFalsy();
    expect(sink.posted).toEqual([]);
  });

  // Criteria 2, 5 and 7 at once. The step name is threaded through from
  // the call site rather than stubbed — `archive` says "archive" — and
  // the specs repo is not a code root, so an event for it proves the
  // report is not gated the way the install is.
  test.each(["analyze", "archive"])(
    "a landed %s step reports the merge of a specs-only repo",
    async (step) => {
      const dir = own(`aide-158-${step}-`);
      const paths = repos(dir);
      const git = gitFor();
      const sink = mergeEventSink();
      const { base } = serverWith(dir, paths, git, sink);
      // A code root that is never landed here: an event for it would
      // mean the report followed the install's gate after all.
      installs(paths.project);

      const landed = await stepWithResult(base, dir, step, {
        branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
      });

      expect(landed.error).toBeFalsy();
      expect(sink.posted.length).toBe(1);
      expect(sink.posted[0]).toEqual({
        project: "aide",
        specFolder: SPEC,
        branch: BRANCH,
        repoRoot: paths.specs,
        step,
        jobId: landed.id,
        timestamp: expect.any(String),
      });
      const stamp = sink.posted[0].timestamp as string;
      expect(new Date(stamp).toISOString()).toBe(stamp);
    },
  );

  // Criterion 4. One run, two repos, two events — each naming its own
  // root. A single event per landing would leave the code merge, the
  // one that matters most, unreported whenever a specs merge preceded it.
  test("a landing that merges two repos reports both, each by its own root", async () => {
    const dir = own("aide-158-two-repos-");
    const paths = repos(dir);
    const git = gitFor();
    const sink = mergeEventSink();
    const { base } = serverWith(dir, paths, git, sink);

    const landed = await stepWithResult(base, dir, "archive", {
      branchUrls: [
        { root: paths.project, url: "https://example.test/aide" },
        { root: paths.specs, url: "https://example.test/aide-specs" },
      ],
    });

    expect(landed.error).toBeFalsy();
    expect(sink.posted.map((e) => e.repoRoot).sort()).toEqual([paths.project, paths.specs].sort());
    expect(sink.posted.every((e) => e.step === "archive" && e.branch === BRANCH)).toBe(true);
  });

  // Criterion 3. The same rule `installAfterMerge` already keeps: the
  // merge happened, so a report that cannot be delivered is noted beside
  // it and never turns a completed merge into a failed one.
  test("a report that throws leaves the landing successful", async () => {
    const dir = own("aide-158-report-fails-");
    const paths = repos(dir);
    const git = gitFor();
    const thrower = (async () => {
      throw new Error("claude-usage is down");
    }) as unknown as typeof fetch;
    const { base } = serverWith(dir, paths, git, {
      mergeEventUrl: "http://claude-usage.test/api/merge-event",
      mergeEventFetch: thrower,
    });

    const landed = await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(landed.error).toBeFalsy();
    expect(landed.errorReason).toBeFalsy();
    expect(merges(git.calls, paths.specs).length).toBeGreaterThan(0);
    expect(landed.branchUrls).toEqual([]);
  });

  // And the same for a sink that answers but refuses.
  test("a report the sink refuses leaves the landing successful", async () => {
    const dir = own("aide-158-report-refused-");
    const paths = repos(dir);
    const git = gitFor();
    const sink = mergeEventSink(() => new Response("no", { status: 500 }));
    const { base } = serverWith(dir, paths, git, sink);

    const landed = await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(landed.error).toBeFalsy();
    expect(sink.posted.length).toBe(1);
  });

  // A merge that never happened is not an event. The ledger's whole
  // question is "was this merge reviewed?" — a refused merge reported as
  // one would be an answer about work that is not on the default branch.
  test("a landing that conflicts reports nothing for the repo it could not merge", async () => {
    const dir = own("aide-158-conflict-");
    const paths = repos(dir);
    const git = gitFor({ conflicting: [paths.specs] });
    const sink = mergeEventSink();
    const { base } = serverWith(dir, paths, git, sink);

    const failed = await stepWithResult(
      base,
      dir,
      "analyze",
      { branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }] },
      (j) => !!j.error,
    );

    expect(String(failed.error)).toContain(paths.specs);
    expect(sink.posted).toEqual([]);
  }, 20000);

  // --- spec 193: a landing that failed is not a spec that is done ----------
  //
  // Three specs reached the archive with their code still on a branch,
  // and every row said done: the archive STEP succeeded, so the job
  // stayed `done`, and the landing after it wrote only a sentence
  // nothing was drawing. The queue's memory of its own pushes is not
  // the answer to "does this spec still have a branch open" — origin
  // is.
  describe("an archive landing asks origin whether anything stayed open", () => {
    /** Spec 146's shape: the implement was run BY HAND, so the queue
     *  holds no job carrying the project root and archive's own run
     *  reports the specs repo alone. Nothing in the merge loop ever
     *  mentions the code branch, and it is still on origin. */
    const onlyTheSpecsRepo = (paths: { specs: string }) => ({
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    // Criterion 2.
    test("a branch left on origin in a repo the loop never saw is a failed job", async () => {
      const dir = own("aide-193-unlanded-");
      const paths = repos(dir);
      const git = gitFor({ openOn: [paths.project] });
      const { base } = serverWith(dir, paths, git);

      const failed = await stepWithResult(
        base,
        dir,
        "archive",
        onlyTheSpecsRepo(paths),
        (j) => !!j.error,
      );

      expect(failed.state).toBe("failed");
      expect(failed.errorReason).toBe("unlanded");
      expect(String(failed.error)).toContain(paths.project);
      expect(String(failed.error)).toContain(BRANCH);
      // Spec 201: the state is half the sentence — the other half is
      // the move. The row's own button already offers it; the message
      // has to say so.
      expect(String(failed.error).toLowerCase()).toContain("run archive again");
    }, 20000);

    // Criterion 3. The happy path is the one this whole change must not
    // break: a landing that merged everything leaves no branch behind,
    // so origin agrees and the job stays exactly as it was.
    test("a landing that left nothing on origin stays done, with no error", async () => {
      const dir = own("aide-193-clean-");
      const paths = repos(dir);
      const git = gitFor({ openOn: [paths.project, paths.specs] });
      const { base } = serverWith(dir, paths, git);

      await stepWithResult(
        base,
        dir,
        "implement",
        { branchUrls: [{ root: paths.project, url: "https://example.test/aide" }] },
        (j) => j.state === "done",
      );
      const landed = await stepWithResult(base, dir, "archive", onlyTheSpecsRepo(paths));

      expect(landed.state).toBe("done");
      expect(landed.error).toBeFalsy();
      expect(landed.errorReason).toBeFalsy();
    });

    // Criterion 4. An unanswerable question is not evidence. Same
    // fixture as criterion 2 — the branch really is still open — with
    // an origin that cannot be reached.
    test("a question origin cannot answer invents no failure", async () => {
      const dir = own("aide-193-unanswerable-");
      const paths = repos(dir);
      const git = gitFor({ openOn: [paths.project], lsRemoteCode: 128 });
      const { base } = serverWith(dir, paths, git);

      const landed = await stepWithResult(base, dir, "archive", onlyTheSpecsRepo(paths));

      expect(landed.state).toBe("done");
      expect(landed.error).toBeFalsy();
    });

    // Criterion 9. The verification is ARCHIVE's alone. An analyze runs
    // while implement's code branch is legitimately open, and the same
    // check there would call a healthy landing failed.
    test("an analyze landing is not asked, and stays done beside an open code branch", async () => {
      const dir = own("aide-193-analyze-");
      const paths = repos(dir);
      const git = gitFor({ openOn: [paths.project] });
      const { base } = serverWith(dir, paths, git);

      const landed = await stepWithResult(base, dir, "analyze", onlyTheSpecsRepo(paths));

      expect(landed.state).toBe("done");
      expect(landed.error).toBeFalsy();
      // The SWEEP, not `isMerged`'s per-branch question: that one runs
      // on every page load and says nothing about the landing.
      expect(git.calls.some((c) => c.args.includes("refs/heads/aide/*"))).toBe(false);
    });

    // Criterion 10. `complete()` may already have queued the job's NEXT
    // step by the time the landing's promise settles, and a landing
    // must not overwrite a job that has moved on.
    test("a failed landing does not overwrite a job whose next step is queued", async () => {
      const dir = own("aide-193-moved-on-");
      const paths = repos(dir);
      const git = gitFor({ conflicting: [paths.specs] });
      const { base } = serverWith(dir, paths, git);

      const made = (await (
        await fetch(`${base}/api/queue`, {
          method: "POST",
          headers: AUTH,
          body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["analyze", "implement"] }),
        })
      ).json()) as { job: { id: string } };
      writeFileSync(
        join(resultDir(dir), `${made.job.id}.json`),
        JSON.stringify(result(onlyTheSpecsRepo(paths))),
      );
      const after = await settle(base, made.job.id, (j) => !!j.error || j.state === "failed");

      // Queued for implement, with the analyze landing's refusal on the
      // row beside it — not stranded as a failed job.
      expect(after.state).toBe("queued");
      expect(String(after.error)).toContain(paths.specs);
    }, 20000);

    // Criterion 8. The way out. A re-run of `archive` needs no new step:
    // the runner hands archive the open merge, the skill resolves it,
    // and the landing that follows merges cleanly.
    describe("archive can be enqueued again for such a spec", () => {
      /** A server whose spec is ALREADY in `archive/` on disk — the
       *  state the three stranded specs are in — with `GET /` run once,
       *  because that is where the archived-with-an-open-branch set is
       *  refreshed. An un-refreshed set is empty, so the enqueue fails
       *  closed. */
      async function archivedServer(name: string, branchStillOpen: boolean) {
        const dir = own(name);
        const paths = repos(dir);
        paths.archiveSpec();
        const git = gitFor({ openOn: branchStillOpen ? [paths.project] : [] });
        const { base } = serverWith(dir, paths, git);
        await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } });
        return { base, paths };
      }

      const enqueue = (base: string) =>
        fetch(`${base}/api/queue`, {
          method: "POST",
          headers: AUTH,
          body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["archive"] }),
        });

      test("while its branch is still on origin", async () => {
        const { base } = await archivedServer("aide-193-rerun-open-", true);
        expect((await enqueue(base)).status).toBe(200);
      });

      test("and not once the branch is gone", async () => {
        const { base } = await archivedServer("aide-193-rerun-closed-", false);
        expect((await enqueue(base)).status).toBeGreaterThan(399);
      });

      // --- spec 198: the other way out ------------------------------------
      //
      // An archived spec can also be REOPENED, and unlike the re-run
      // above that does not depend on a branch being open — a spec whose
      // work has to be done again is one that finished cleanly, most of
      // the time. The two exceptions are kept apart in the resolver for
      // that reason: `specFolders` carries spec 193's open-branch
      // exception and admits every step, `archivedFolders` carries this
      // one and admits `reopen` alone.
      const enqueueReopen = (base: string, steps: string[] = ["reopen"]) =>
        fetch(`${base}/api/queue`, {
          method: "POST",
          headers: AUTH,
          body: JSON.stringify({ project: "aide", specFolder: SPEC, steps }),
        });

      test("reopen is accepted for an archived spec whose branch is gone", async () => {
        const { base } = await archivedServer("aide-198-reopen-closed-", false);
        expect((await enqueueReopen(base)).status).toBe(200);
      });

      test("and every other step still is not", async () => {
        const { base } = await archivedServer("aide-198-reopen-other-", false);
        const res = await enqueueReopen(base, ["implement"]);
        expect(res.status).toBeGreaterThan(399);
        expect(String((await res.json() as { error?: string }).error)).toContain("archived");
      });

      // A no-script form POST gets a redirect and nothing else, and the
      // specs list has no row for an archived spec to put the answer on.
      // The reader comes back to the page the button is on.
      test("a form press comes back to the spec's own page", async () => {
        const { base } = await archivedServer("aide-198-reopen-back-", false);
        const res = await fetch(`${base}/api/queue`, {
          method: "POST",
          headers: { "x-aide-token": TOKEN, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ project: "aide", specFolder: SPEC, steps: "reopen" }),
          redirect: "manual",
        });
        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.headers.get("location")).toContain(`/specs/aide/${SPEC}`);
      });
    });
  });

  // --- spec 220: merge the code, or open a pull request ---------------------
  //
  // Everything above lands code straight onto the default branch, which
  // is the only behaviour there has ever been. A project whose team
  // reviews its code says so in its committed manifest, and then archive
  // lands the PLAN and leaves the code on its branch for the pull
  // request `aide-run-spec` opened. The specs root is never gated: an
  // archive commit moving a folder is bookkeeping, not a change anyone
  // reviews.
  describe("a project can leave its code for a pull request (spec 220)", () => {
    /** The project's manifest, with the choice written into it. `repos`
     *  writes a bare `name: aide` one; this is the same file with the
     *  spec's own key added. */
    const landsWith = (paths: { project: string }, value: string | null): void => {
      writeFileSync(
        join(paths.project, ".aide", "project.yaml"),
        `name: aide\n${value ? `codeLanding: ${value}\n` : ""}`,
      );
    };

    const onlyTheSpecsRepo = (paths: { specs: string }) => ({
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    /** An implement step's result, which is what puts the code branch —
     *  and, in `pr` mode, the pull request `aide-run-spec` opened for it
     *  — onto the job in the first place. Archive never touches the
     *  project root, so this is the only step that can carry them. */
    const implemented = async (
      base: string,
      dir: string,
      paths: { project: string },
      over: Record<string, unknown> = {},
    ) =>
      stepWithResult(
        base,
        dir,
        "implement",
        { branchUrls: [{ root: paths.project, url: "https://example.test/aide" }], ...over },
        (j) => j.state === "done",
      );

    // Acceptance criterion 3, and the whole point of the spec.
    test("archive merges the plan and leaves the code on its branch", async () => {
      const dir = own("aide-220-pr-mode-");
      const paths = repos(dir);
      landsWith(paths, "pr");
      const git = gitFor({ openOn: [paths.project, paths.specs] });
      const { base } = serverWith(dir, paths, git);
      const marker = installs(paths.project);
      landsWith(paths, "pr"); // `installs` rewrites .aide/config, not the manifest

      await implemented(base, dir, paths);
      const landed = await stepWithResult(base, dir, "archive", onlyTheSpecsRepo(paths));

      expect(merges(git.calls, paths.specs).length).toBeGreaterThan(0);
      expect(merges(git.calls, paths.project)).toEqual([]);
      // A success, not a refusal: nothing to resolve, nothing to re-run.
      expect(landed.state).toBe("done");
      expect(landed.error).toBeFalsy();
      expect(landed.errorReason).toBeFalsy();
      // And nothing was installed from a merge that deliberately did not
      // happen — the install belongs to code reaching the default
      // branch, which is exactly what the pull request has not done yet.
      expect(existsSync(marker)).toBe(false);
    }, 20000);

    // Acceptance criterion 3's sharpest half, in isolation. The
    // archive-only origin re-check asks whether ANY of the project's
    // roots still holds the branch, and in `pr` mode the code root
    // always does — by design. Left unhandled this reports every working
    // PR-mode archive as a failed, unlanded landing.
    test("the origin re-check does not call the open code branch unlanded", async () => {
      const dir = own("aide-220-recheck-");
      const paths = repos(dir);
      landsWith(paths, "pr");
      // Open in the code root ALONE: the specs merge takes the specs
      // root out of the set, so what is left on origin afterwards is
      // exactly the branch this spec means to leave there.
      const git = gitFor({ openOn: [paths.project] });
      const { base } = serverWith(dir, paths, git);

      const landed = await stepWithResult(base, dir, "archive", onlyTheSpecsRepo(paths));

      // The sweep really did run and really did find it...
      expect(git.calls.some((c) => c.args.includes("refs/heads/aide/*"))).toBe(true);
      // ...and said nothing, because a root the landing chose not to
      // merge is not a root that failed to merge.
      expect(landed.state).toBe("done");
      expect(landed.errorReason).toBeFalsy();
      expect(String(landed.error ?? "")).not.toContain("has not landed");
    }, 20000);

    // Acceptance criterion 1. The regression guard, as its own case: the
    // behaviour every project on the host has today must be reachable
    // both by saying nothing and by saying `merge` out loud.
    test.each([null, "merge"])("a project that says %p merges its code exactly as before", async (value) => {
      const dir = own(`aide-220-merge-${value ?? "unset"}-`);
      const paths = repos(dir);
      landsWith(paths, value);
      const git = gitFor({ openOn: [paths.project, paths.specs] });
      const { base } = serverWith(dir, paths, git);

      await implemented(base, dir, paths);
      const landed = await stepWithResult(base, dir, "archive", onlyTheSpecsRepo(paths));

      expect(merges(git.calls, paths.project).length).toBeGreaterThan(0);
      expect(merges(git.calls, paths.specs).length).toBeGreaterThan(0);
      expect(landed.state).toBe("done");
      expect(landed.error).toBeFalsy();
      // Landed, so the row stops advertising a branch — the behaviour
      // spec 149 gave it.
      expect(landed.branchUrls).toEqual([]);
    }, 20000);

    // Acceptance criterion 4. The row has to SAY what happened, or a
    // reader cannot tell a deliberate open branch from a stuck one. The
    // pull request comes off the step that opened it — `implement`, the
    // only step that touches the project root at all.
    test("the pull request the run opened stays on the row", async () => {
      const dir = own("aide-220-prurl-");
      const paths = repos(dir);
      landsWith(paths, "pr");
      const git = gitFor({ openOn: [paths.project, paths.specs] });
      const { base } = serverWith(dir, paths, git);

      await implemented(base, dir, paths, { prUrl: "https://github.test/aide/pull/7" });
      const landed = await stepWithResult(base, dir, "archive", onlyTheSpecsRepo(paths));

      expect(landed.prUrl).toBe("https://github.test/aide/pull/7");
      // And the branch it points at is still named on the row: the code
      // is there and nowhere else until somebody merges the request.
      expect((landed.branchUrls as { root: string }[]).map((b) => b.root)).toContain(paths.project);
    }, 20000);

    // Acceptance criterion 7. `gh` on an unattended machine needs an
    // interactive re-auth only a person can do, and this spec gives that
    // failure teeth: the landing now trusts `pr` to mean a request
    // exists. A branch left open with nothing describing it has to say
    // so.
    test("a gh failure is reported beside the branch it left open", async () => {
      const dir = own("aide-220-prerror-");
      const paths = repos(dir);
      landsWith(paths, "pr");
      const git = gitFor({ openOn: [paths.project, paths.specs] });
      const { base } = serverWith(dir, paths, git);

      await implemented(base, dir, paths, { prError: "gh auth login required" });
      const landed = await stepWithResult(base, dir, "archive", onlyTheSpecsRepo(paths));

      expect(landed.prError).toBe("gh auth login required");
      expect(landed.prUrl).toBeFalsy();
      // Still not a failed job: the code IS on its branch, which is
      // where PR mode wanted it. What is missing is the request.
      expect(landed.state).toBe("done");
    }, 20000);
  });
});

// Spec 254: `Runner.complete()` writes `state: "done"` and `landing: true`
// in the same update — the merge into the default branch has not
// happened yet. This holds that merge open the way
// `cache-warmer.test.ts`'s `recordingGit({ hold })` holds `ls-remote`,
// long enough to observe the job mid-landing.
describe("a step reads busy for the whole landing window (spec 254)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const SPEC = "81-queue-and-runner";

  function own(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    ownDirs.push(dir);
    return dir;
  }

  function repos(dir: string): { root: string; specs: string } {
    const projectsRoot = join(dir, "root");
    const project = join(projectsRoot, "aide");
    const specs = join(dir, "aide-specs");
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\n");
    mkdirSync(join(project, "specs", SPEC), { recursive: true });
    writeFileSync(join(project, "specs", SPEC, "1-description.md"), "# 81 - Description\n");
    writeFileSync(join(project, "specs", SPEC, "4-status.md"), statusSaying(["create", "analyze"]));
    mkdirSync(specs, { recursive: true });
    return { root: projectsRoot, specs };
  }

  /** A git whose merge does not return until `release()` is called — the
   *  window between a step's own result arriving and the merge that
   *  lands it actually resolving, held open long enough to observe it. */
  function heldGit() {
    const calls: { dir: string; args: string[] }[] = [];
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("merge -q --ff-only") || a.startsWith("merge -q --no-edit")) {
        await gate;
        return { code: 0, stdout: "" };
      }
      if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
      return { code: 0, stdout: "" };
    };
    return { run, calls, release: () => release() };
  }

  async function runStep(base: string, specFolder: string, step: string): Promise<{ id: string }> {
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder, steps: [step] }),
      })
    ).json()) as { job: { id: string } };
    return made.job;
  }

  async function settle(
    base: string,
    id: string,
    done: (job: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    for (let n = 0; n < 100; n++) {
      const body = (await (await fetch(`${base}/api/queue/${id}`, { headers: AUTH })).json()) as {
        job: Record<string, unknown>;
      };
      if (done(body.job)) return body.job;
      await Bun.sleep(50);
    }
    throw new Error("the job never settled");
  }

  function serverWithHeldMerge(dir: string, paths: { root: string }, git: { run: GitRunner }) {
    const results = join(dir, "jobs");
    mkdirSync(results, { recursive: true });
    return { ...harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        gitRun: git.run,
        queueRunnerBin: "/usr/bin/true",
        queueResultDir: results,
      },
    }), results };
  }

  const ANALYZE_RESULT = (specs: string) => ({
    ok: true,
    exitCode: 0,
    costUsd: 0.2,
    costMeasured: true,
    terminalReason: "completed",
    branch: `aide/${SPEC}`,
    repos: [],
    branchUrls: [{ root: specs, url: "https://example.test/aide-specs" }],
  });

  // Criteria 1 and 2. `job.landing` is already true the instant the
  // step's own result arrives — well before the merge below returns.
  test("mid-landing the job reads landing:true and a same-spec enqueue is refused", async () => {
    const dir = own("aide-254-landing-");
    const paths = repos(dir);
    const git = heldGit();
    const { base, results } = serverWithHeldMerge(dir, paths, git);

    const job = await runStep(base, SPEC, "analyze");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ANALYZE_RESULT(paths.specs)));

    const midLanding = await settle(base, job.id, (j) => j.state === "done");
    expect(midLanding.landing).toBe(true);

    const refused = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["implement"] }),
    });
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { error?: string };
    expect(String(body.error ?? "")).toContain(SPEC);

    git.release();
    await settle(base, job.id, (j) => !j.landing);
  });

  // Criterion 5. A newer job that has already settled (cancelled, in
  // this case) must not push a still-landing job out of the lead slot
  // by coincidence of sort order.
  test("the single-spec page picks the still-landing job as lead, not a newer settled one", async () => {
    const dir = own("aide-254-lead-");
    const paths = repos(dir);
    const git = heldGit();
    const { base, results } = serverWithHeldMerge(dir, paths, git);

    const job = await runStep(base, SPEC, "analyze");
    // Wait for the analyze job to actually start, so the decoy below is
    // enqueued — and therefore timestamped — after it.
    await settle(base, job.id, (j) => j.state === "running");
    const decoy = await runStep(base, SPEC, "implement");
    const cancelled = await fetch(`${base}/api/queue/${decoy.id}/cancel`, { method: "POST", headers: AUTH });
    expect(cancelled.status).toBe(200);
    await settle(base, decoy.id, (j) => j.state === "cancelled");

    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ANALYZE_RESULT(paths.specs)));
    await settle(base, job.id, (j) => j.state === "done");

    const html = await (await fetch(`${base}/specs/aide/${SPEC}`, { headers: AUTH })).text();
    const banner = html.match(/<div class="pagehead">([\s\S]*?)<span class="row">/)?.[1] ?? "";
    expect(banner).toContain('class="badge b-done">');
    expect(banner).not.toContain('b-idle">cancelled');

    git.release();
    await settle(base, job.id, (j) => !j.landing);
  });
});
// --- spec 99: one merge at a time, the view survives, a refusal is seen -----

// Pressing Merge on two specs one after the other, with nothing else
// running, answered "cannot fast-forward main in …/aide-specs — merge
// it by hand" between the clicks: both requests share one checkout and
// fought over its index.lock. Both went through on a retry, which is
// what says it was a race and not a divergence.
//
// Spec 149 removed the button and made the collision likelier, not
// rarer: four steps land themselves now, and two specs sharing one
// specs repo can finish within seconds of each other under queue
// concurrency. So the same measurement is taken over two LANDINGS.
describe("two landings against one repo run one at a time (criteria 6, 10)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const SHARED_REPO = "/repos/aide-specs";
  const SECOND_SPEC = "82-second-spec";

  /** A git slow enough to overlap, that counts how many mutating calls
   *  are in flight against one root at once. `switch`, `pull`, `merge`
   *  and `push` are the four that touch the checkout — a second one
   *  arriving while the first is unfinished is precisely the collision. */
  function gitCounting() {
    const MUTATING = new Set(["switch", "pull", "merge", "push"]);
    let inFlight = 0;
    let peak = 0;
    const run = async (_dir: string, args: string[]) => {
      const a = args.join(" ");
      const mutating = MUTATING.has(args[0]!);
      if (mutating) {
        inFlight++;
        peak = Math.max(peak, inFlight);
      }
      await new Promise((r) => setTimeout(r, 5));
      if (mutating) inFlight--;
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
      return { code: 0, stdout: "" };
    };
    return { run, peak: () => peak };
  }

  test("neither landing ever sees the other mid-merge, and both go through (criterion 6)", async () => {
    const results = mkdtempSync(join(tmpdir(), "aide-lock-results-"));
    ownDirs.push(results);
    const git = gitCounting();
    const { base } = start(
      {
        queueToken: TOKEN,
        gitRun: git.run,
        queueRunnerBin: "/usr/bin/true",
        queueResultDir: results,
        queueConcurrency: 2,
      },
      [],
      [SECOND_SPEC],
    );

    // Two analyze steps on two specs, both landing in the SAME specs
    // repo — which every spec shares, because every spec's plan lives
    // in the specs root.
    const settled = await Promise.all(
      ["81-queue-and-runner", SECOND_SPEC].map(async (specFolder) => {
        const made = (await (
          await fetch(`${base}/api/queue`, {
            method: "POST",
            headers: AUTH,
            body: JSON.stringify({ project: "aide", specFolder, steps: ["analyze"] }),
          })
        ).json()) as { job: { id: string } };
        writeFileSync(
          join(results, `${made.job.id}.json`),
          JSON.stringify({
            ok: true,
            exitCode: 0,
            costUsd: 0.1,
            costMeasured: true,
            terminalReason: "completed",
            branch: `aide/${specFolder}`,
            branchUrls: [{ root: SHARED_REPO, url: "https://example.test/aide-specs" }],
            repos: [],
          }),
        );
        for (let n = 0; n < 100; n++) {
          const body = (await (await fetch(`${base}/api/queue/${made.job.id}`, { headers: AUTH })).json()) as {
            job: Record<string, unknown>;
          };
          if (body.job.state === "done" && !body.job.landing) return body.job;
          await Bun.sleep(50);
        }
        throw new Error("the job never settled");
      }),
    );

    for (const job of settled) expect(job.error).toBeFalsy();
    // Both landed: the branch each job advertised is gone from its row.
    for (const job of settled) expect(job.branchUrls).toEqual([]);
    expect(git.peak()).toBe(1);
  });
});

// The lock is a map of chained promises, and a map a long-running
// server never empties is a map that grows for as long as it is up.
describe("the per-repo lock lets go once its chain has settled (criterion 10)", () => {
  test("work for one root is serialized, in the order it was asked for", async () => {
    const lock = createRootLock();
    const order: string[] = [];
    const slow = (name: string, ms: number) => async () => {
      order.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${name}:end`);
      return name;
    };
    const both = Promise.all([lock.run("/repo", slow("a", 20)), lock.run("/repo", slow("b", 1))]);
    expect(await both).toEqual(["a", "b"]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  test("two different roots do not wait for each other", async () => {
    const lock = createRootLock();
    let peak = 0;
    let inFlight = 0;
    const job = async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    };
    await Promise.all([lock.run("/a", job), lock.run("/b", job)]);
    expect(peak).toBe(2);
  });

  test("the map holds nothing once the last request for a root is done", async () => {
    const lock = createRootLock();
    await Promise.all([
      lock.run("/repo", async () => new Promise((r) => setTimeout(r, 5))),
      lock.run("/repo", async () => new Promise((r) => setTimeout(r, 5))),
      lock.run("/other", async () => new Promise((r) => setTimeout(r, 5))),
    ]);
    // One turn of the microtask queue for the cleanup that runs after
    // the last chain settles.
    await new Promise((r) => setTimeout(r, 0));
    expect(lock.size).toBe(0);
  });

  test("one turn throwing does not poison the next", async () => {
    const lock = createRootLock();
    const failed = lock.run("/repo", async () => {
      throw new Error("git blew up");
    });
    await expect(failed).rejects.toThrow("git blew up");
    expect(await lock.run("/repo", async () => "fine")).toBe("fine");
  });
});

// "All" + "Spec, descending" survived the five-second refresh but not an
// action: every POST answered 303 to the bare list address, so pressing any
// button dropped the reader back into the default view.
describe("an action keeps the page's view (criterion 7)", () => {
  const FORM = { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN };
  const VIEW = { "view.state": "active", "view.sort": "cost", "view.dir": "desc" };

  const post = (base: string, path: string, fields: Record<string, string>) =>
    fetch(`${base}${path}`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams(fields),
    });

  /** One job in the mirror, in the state the test needs it. */
  async function seededJob(state: string): Promise<{ mirror: string; id: string }> {
    const { base, dir } = start({ queueToken: TOKEN });
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
        body: JSON.stringify(JOB),
      })
    ).json()) as { job: { id: string } };
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    jobs.find((j) => j.id === made.job.id)!.state = state;
    writeFileSync(mirror, JSON.stringify(jobs));
    return { mirror, id: made.job.id };
  }

  test("Run carries the view forward on success", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await post(base, "/api/queue", {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "analyze",
      ...VIEW,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?state=active&sort=cost&dir=desc");
  });

  test("Run carries the view forward on a refusal too", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await post(base, "/api/queue", { project: "nope", specFolder: "x", steps: "analyze", ...VIEW });
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location.startsWith("/?state=active&sort=cost&dir=desc&error=")).toBe(true);
  });

  test("Cancel carries the view forward", async () => {
    const { mirror, id } = await seededJob("running");
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror });
    const res = await post(base, `/api/queue/${id}/cancel`, VIEW);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?state=active&sort=cost&dir=desc");
  });

  // The exact assertion spec 81 wrote: with nothing to carry, the
  // redirect is `/` and not `/?`.
  test("with no view submitted the redirect stays exactly /", async () => {
    const { mirror, id } = await seededJob("running");
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror });
    const res = await post(base, `/api/queue/${id}/cancel`, {});
    expect(res.headers.get("location")).toBe("/");
  });
});

// A refusal landed on the page that followed the redirect, at the top,
// belonging to no row — and serve.log had no line for any refusal at
// all on the day this was written.
describe("a refusal names its spec and reaches the log (criteria 8, 9, 11)", () => {
  const FORM = { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN };
  const SPEC = "aide/81-queue-and-runner";

  /** `console.error` for the duration of one test. serve.log is both
   *  streams of the same launchd job, so the call IS the log line. */
  async function capturingLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      return { result: await fn(), lines };
    } finally {
      console.error = original;
    }
  }

  // Spec 106's own chain — git says "conflict", and the row ends up
  // showing it — used to run through this redirect, and was
  // tested here. Since spec 149 the reason is stored on the JOB instead,
  // because a landing has no browser to redirect; the chain is covered
  // end to end in "every step lands its own work" above.

  test("an enqueue refusal names the spec it was for (criterion 9)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const { result: res, lines } = await capturingLog(() =>
      fetch(`${base}/api/queue`, {
        method: "POST",
        redirect: "manual",
        headers: FORM,
        body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "nonsense" }),
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain(`errorSpec=${encodeURIComponent(SPEC)}`);
    expect(lines.join("\n")).toContain(SPEC);
  });

  // Spec 101: the page stopped navigating on a refusal, so the row it
  // belongs to is now picked out from the JSON body rather than from a
  // redirect the server built. Merge already said which spec; Run and
  // approve said only why, which left three of the four actions with no
  // row to land on.
  test("a refused Run says which spec it was for, to a JSON caller too", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      body: JSON.stringify({ ...JOB, steps: ["nonsense"] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ spec: SPEC });
  });

  // Criterion 9: the script above these forms is an enhancement, never
  // the mechanism. A browser with JavaScript off posts the form itself
  // and must still get the 303 back to the list.
  test("a form post with no JSON accept header still gets its 303", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const run = await fetch(`${base}/api/queue`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "analyze" }),
    });
    expect(run.status).toBe(303);
    const id = (JSON.parse(readFileSync(join(dir, "queue.json"), "utf-8")) as { id: string }[])[0]!.id;
    const cancelled = await fetch(`${base}/api/queue/${id}/cancel`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ "view.state": "active" }),
    });
    expect(cancelled.status).toBe(303);
    expect(cancelled.headers.get("location")).toContain("state=active");
    const created = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ project: "aide", title: "", description: "" }),
    });
    expect(created.status).toBe(303);
  });

});
