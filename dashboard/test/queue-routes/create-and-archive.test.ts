import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ServerOptions,
} from "../../src/serve/serve.ts";
import { statusSaying } from "../helpers/queue-server.ts";
import {
  TOKEN,
  JOB,
  specHead,
  specControls,
  openQuery,
  mergeEventSink,
  setupQueueRoutesHarness,
} from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

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
