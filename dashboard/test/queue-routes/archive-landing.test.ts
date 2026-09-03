// Split out of create-and-archive.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ServerOptions } from "../../src/serve/serve.ts";
import { statusSaying } from "../helpers/queue-server.ts";
import { ARCHIVED_VIEW, blockFor, listUntil, rowFor } from "../archived-specs-fixtures.ts";
import {
  TOKEN,
  specHead,
  setupQueueRoutesHarness,
} from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
const SPECS_REPO = "/repos/aide-specs";

function gitFor({
  conflicting = [],
  needsRealMerge = [],
  gone = [],
  deleteFails = [],
  stillOpenAfterDelete = [],
}: {
  conflicting?: string[];
  needsRealMerge?: string[];
  gone?: string[];
  /** spec 319: roots whose `push -q origin --delete <branch>` fails —
   *  the merge itself still succeeds, only the tidy-up does not. */
  deleteFails?: string[];
  /** spec 319: roots the post-loop `ls-remote --heads ... refs/heads/
   *  aide/*` check should still report `branch` open on — the fixture
   *  a delete-fails root needs so `rootsStillHolding` finds it again,
   *  the way real origin would after a rejected delete. */
  stillOpenAfterDelete?: { root: string; branch: string }[];
} = {}) {
  const calls: { dir: string; args: string[] }[] = [];
  const run = async (dir: string, args: string[]) => {
    calls.push({ dir, args });
    const a = args.join(" ");
    if (a.startsWith("ls-remote --exit-code") && gone.includes(dir)) return { code: 2, stdout: "" };
    if (a.startsWith("ls-remote --heads")) {
      const open = stillOpenAfterDelete.filter((o) => o.root === dir);
      if (open.length) {
        return { code: 0, stdout: open.map((o) => `abc123\trefs/heads/${o.branch}\n`).join("") };
      }
      return { code: 0, stdout: "" };
    }
    if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
    if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
    if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
    if (a.startsWith("merge -q --ff-only origin/")) return { code: 0, stdout: "" };
    if (a.startsWith("merge -q --ff-only")) {
      return { code: conflicting.includes(dir) || needsRealMerge.includes(dir) ? 1 : 0, stdout: "" };
    }
    if (a.startsWith("merge -q --no-edit")) return { code: conflicting.includes(dir) ? 1 : 0, stdout: "" };
    if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
    if (a.startsWith("push -q origin --delete") && deleteFails.includes(dir)) {
      return { code: 1, stdout: "", stderr: "remote rejected: hook declined" };
    }
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
  const SPEC = "81-queue-and-runner";
  const BRANCH = `aide/${SPEC}`;

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

  const merges = (calls: { dir: string; args: string[] }[]) =>
    calls.filter((c) => c.args[0] === "merge" && c.args.includes(`refs/remotes/origin/${BRANCH}`));

  // Criterion 1. This archive job is the FIRST the queue has ever run
  // for this spec, so `branchesFor()` — read synchronously inside the
  // same call stack, before the runner has written this step's own
  // record — would answer with nothing. The landing reads the outcome
  // in hand instead, which has no such timing to get wrong.
  test("a successful archive step is merged and pushed with no Merge press", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(start, "aide-archive-results-", git);
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
    const { base, results } = serverWithRunner(start, "aide-archive-results-", git);
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
    const { base, results } = serverWithRunner(start, "aide-archive-results-", git);
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
    const { base, results } = serverWithRunner(start, "aide-archive-results-", git);
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
    const { base, results } = serverWithRunner(start, "aide-archive-results-", git, { queueProjectRoot: "/repos" });
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
    const { base, results } = serverWithRunner(start, "aide-archive-results-", git, { queueProjectRoot: "/repos" });
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

  // --- spec 280: code lands before specs, and a code failure stops the ------
  // specs root from ever being attempted --------------------------------------
  //
  // Every OTHER landing merges specs first, code last (the file's own
  // comment above the sort explains why: a reader watching the page
  // sees the code land before the plan describing it). `archive` is the
  // one exception: its specs root carries the `Result: completed` /
  // `Workflow steps completed` stamp, and that stamp must never reach
  // `main` before the code root's own landing is confirmed.
  describe("code lands before specs for archive (spec 280)", () => {
    const CODE_REPO = "/repos/aide";
    const TWO_REPOS = [
      { root: SPECS_REPO, url: "https://example.test/aide-specs" },
      { root: CODE_REPO, url: "https://example.test/aide" },
    ];

    test("AC8: a failing code root stops the loop before the specs root is attempted", async () => {
      const git = gitFor({ conflicting: [CODE_REPO] });
      const { base, results } = serverWithRunner(start, "aide-archive-results-", git, {
        queueProjectRoot: "/repos",
      });
      const job = await runStep(base, "archive");
      writeFileSync(
        join(results, `${job.id}.json`),
        JSON.stringify({ ...ARCHIVE_RESULT, branchUrls: TWO_REPOS }),
      );
      const failed = await settle(base, job.id, (j) => !!j.error);

      expect(String(failed.error)).toContain(CODE_REPO);
      expect(String(failed.error)).toContain("conflict");
      expect(failed.errorReason).toBe("conflict");
      // The code root was attempted (and failed) — the specs root, which
      // carries the "completed" stamp, was never attempted at all.
      expect(merges(git.calls).some((c) => c.dir === CODE_REPO)).toBe(true);
      expect(merges(git.calls).some((c) => c.dir === SPECS_REPO)).toBe(false);
    });

    test("AC9: a successful code root is followed by the specs root, unaffected", async () => {
      const git = gitFor();
      const { base, results } = serverWithRunner(start, "aide-archive-results-", git, {
        queueProjectRoot: "/repos",
      });
      const job = await runStep(base, "archive");
      writeFileSync(
        join(results, `${job.id}.json`),
        JSON.stringify({ ...ARCHIVE_RESULT, branchUrls: TWO_REPOS }),
      );
      const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

      expect(landed.error).toBeFalsy();
      const merged = merges(git.calls);
      const codeIndex = merged.findIndex((c) => c.dir === CODE_REPO);
      const specsIndex = merged.findIndex((c) => c.dir === SPECS_REPO);
      expect(codeIndex).toBeGreaterThanOrEqual(0);
      expect(specsIndex).toBeGreaterThan(codeIndex);
      expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args[0] === "push")).toBe(true);
      expect(git.calls.some((c) => c.dir === CODE_REPO && c.args[0] === "push")).toBe(true);
      expect(landed.branchUrls).toEqual([]);
    });
  });

  // --- spec 319: a merge that succeeds but cannot delete its own branch ------
  //
  // `mergeBranchIntoDefault` already reports this as `ok: true` with a
  // `branchDeleteError` — the merge genuinely happened, and origin can
  // refuse a delete for reasons outside the dashboard's control. What
  // this closes is the job-level half of the bug: the SAME fact used to
  // risk being re-flagged, a few lines later in the same landing, by the
  // post-loop `rootsStillHolding` check that has no idea the branch it
  // still finds open is the one this very loop just left that way.
  describe("a branch left behind after a successful merge (spec 319)", () => {
    test("settles as done, with no error, and carries the reason on the job", async () => {
      let specsRoot = "";
      const inner = gitFor();
      const git = {
        calls: inner.calls,
        run: async (dir: string, args: string[]) => {
          if (dir === specsRoot) {
            const a = args.join(" ");
            if (a === `push -q origin --delete ${BRANCH}`) {
              inner.calls.push({ dir, args });
              return { code: 1, stdout: "", stderr: "remote rejected: hook declined" };
            }
            if (a.startsWith("ls-remote --heads")) {
              inner.calls.push({ dir, args });
              return { code: 0, stdout: `abc123\trefs/heads/${BRANCH}\n` };
            }
          }
          return inner.run(dir, args);
        },
      };
      const { base, dir, results } = serverWithRunner(start, "aide-archive-results-", git as never);
      specsRoot = join(dir, "root", "aide", "specs");
      const job = await runStep(base, "archive");
      writeFileSync(
        join(results, `${job.id}.json`),
        JSON.stringify({ ...ARCHIVE_RESULT, branchUrls: [{ root: specsRoot, url: "https://example.test/aide-specs" }] }),
      );
      const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

      expect(landed.error).toBeFalsy();
      expect(landed.errorReason).toBeFalsy();
      expect(git.calls.some((c) => c.dir === specsRoot && c.args[0] === "push")).toBe(true);
      expect(String(landed.branchDeleteError)).toContain(specsRoot);
      expect(String(landed.branchDeleteError)).toContain(BRANCH);
      expect(String(landed.branchDeleteError)).toContain("remote rejected: hook declined");
    });

    // Risk mitigation from the plan: the guard must skip only the root
    // its OWN loop just recorded a delete failure for — a root the
    // landing never touched at all, still open for a genuinely
    // different reason, has to keep failing the job exactly as before.
    test("does not silence a genuinely unlanded root beside it", async () => {
      let specsRoot = "";
      let codeRoot = "";
      const inner = gitFor();
      const git = {
        calls: inner.calls,
        run: async (dir: string, args: string[]) => {
          if (dir === specsRoot) {
            const a = args.join(" ");
            if (a === `push -q origin --delete ${BRANCH}`) {
              inner.calls.push({ dir, args });
              return { code: 1, stdout: "", stderr: "remote rejected: hook declined" };
            }
          }
          if ((dir === specsRoot || dir === codeRoot) && args.join(" ").startsWith("ls-remote --heads")) {
            inner.calls.push({ dir, args });
            return { code: 0, stdout: `abc123\trefs/heads/${BRANCH}\n` };
          }
          return inner.run(dir, args);
        },
      };
      const { base, dir, results } = serverWithRunner(start, "aide-archive-results-", git as never);
      specsRoot = join(dir, "root", "aide", "specs");
      codeRoot = join(dir, "root", "aide");
      const job = await runStep(base, "archive");
      // Only the specs root is in THIS landing's own branchUrls — the
      // code root is never merged by it, exactly the shape a job the
      // LRU cap evicted or a step run by hand would leave behind.
      writeFileSync(
        join(results, `${job.id}.json`),
        JSON.stringify({ ...ARCHIVE_RESULT, branchUrls: [{ root: specsRoot, url: "https://example.test/aide-specs" }] }),
      );
      const failed = await settle(base, job.id, (j) => !!j.error);

      expect(String(failed.error)).toContain(codeRoot);
      expect(String(failed.error)).not.toContain(specsRoot);
      expect(failed.errorReason).toBe("unlanded");
    });
  });

  // --- spec 330: one landing error names one path for one checkout ----------
  //
  // `rootsStillHolding`'s raw roots come from `specRoots()`, which is not
  // guaranteed to be a repo's own git top-level — `machinerySpecsRoot()`
  // can be a subdirectory of it. The main merge loop's own failure
  // sentence, by contrast, always names the run's own recorded root
  // (already the true top-level). Two sentences, two different strings,
  // one repository.
  describe("one landing error names one path for one checkout (spec 330)", () => {
    test("the post-loop sentence names the same resolved root the merge loop already failed for", async () => {
      const resolvedRoot = "/repos/aide-specs-real-root";
      let specsRoot = "";
      const inner = gitFor({ conflicting: [resolvedRoot] });
      const git = {
        calls: inner.calls,
        run: async (dir: string, args: string[]) => {
          if (dir === specsRoot) {
            const a = args.join(" ");
            if (a === "rev-parse --show-toplevel") {
              inner.calls.push({ dir, args });
              return { code: 0, stdout: `${resolvedRoot}\n` };
            }
            if (a.startsWith("ls-remote --heads")) {
              inner.calls.push({ dir, args });
              return { code: 0, stdout: `abc123\trefs/heads/${BRANCH}\n` };
            }
          }
          return inner.run(dir, args);
        },
      };
      const { base, dir, results } = serverWithRunner(start, "aide-archive-results-", git as never);
      specsRoot = join(dir, "root", "aide", "specs");
      const job = await runStep(base, "archive");
      writeFileSync(
        join(results, `${job.id}.json`),
        JSON.stringify({ ...ARCHIVE_RESULT, branchUrls: [{ root: resolvedRoot, url: "https://example.test/aide-specs" }] }),
      );
      const failed = await settle(base, job.id, (j) => !!j.error);

      const errorText = String(failed.error);
      expect(errorText).toContain(resolvedRoot);
      expect(errorText).not.toContain(specsRoot);
    });

    // A project whose specs live inside its own code repository:
    // `specRoots()` returns the code root and a subdirectory of that same
    // repo as two separate entries. Both still holding the branch must
    // read as one repository, not two.
    test("two specRoots entries resolving to one repo produce one still-on-origin sentence", async () => {
      let specsRoot = "";
      let codeRoot = "";
      const inner = gitFor();
      const git = {
        calls: inner.calls,
        run: async (dir: string, args: string[]) => {
          const a = args.join(" ");
          if ((dir === specsRoot || dir === codeRoot) && a === "rev-parse --show-toplevel") {
            inner.calls.push({ dir, args });
            return { code: 0, stdout: `${codeRoot}\n` };
          }
          if ((dir === specsRoot || dir === codeRoot) && a.startsWith("ls-remote --heads")) {
            inner.calls.push({ dir, args });
            return { code: 0, stdout: `abc123\trefs/heads/${BRANCH}\n` };
          }
          return inner.run(dir, args);
        },
      };
      const { base, dir, results } = serverWithRunner(start, "aide-archive-results-", git as never);
      specsRoot = join(dir, "root", "aide", "specs");
      codeRoot = join(dir, "root", "aide");
      const job = await runStep(base, "archive");
      writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ARCHIVE_RESULT));
      const failed = await settle(base, job.id, (j) => !!j.error);

      const errorText = String(failed.error);
      const stillOnOrigin = errorText.split("still on origin").length - 1;
      expect(stillOnOrigin).toBe(1);
      expect(errorText).toContain(codeRoot);
    });
  });

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
    const { base, results } = serverWithRunner(start, "aide-archive-results-", git as never);
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
    const { base, results } = serverWithRunner(start, "aide-archive-results-", git);
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
    const { base, dir, results } = serverWithRunner(start, "aide-archive-results-", git);
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
        // An analyzed spec: since spec 344 an `implement` on a spec with
        // no analyze is held back in the queue, and this test needs the
        // step to run so it can watch it NOT land.
        const analyzed = (o: Partial<ServerOptions>) => start(o, [], [], statusSaying(["create", "analyze"]));
        const { base, results } = serverWithRunner(analyzed, "aide-archive-results-", git);
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

// --- spec 319: the row-level half — "branch left behind" is not -----------
// "not landed" -----------------------------------------------------------
//
// An already-archived spec whose branch is still open may have `archive`
// enqueued again (spec 193's own way out): the runner hands that step the
// still-open merge, and it can succeed a second time even though the
// original delete never went through. This proves the row a reader sees
// afterwards says which of the two happened, without opening anything.
describe("the row for a branch left behind after a successful merge (spec 319)", () => {
  const FOLDER = "200-left-behind";
  const BRANCH = `aide/${FOLDER}`;
  // A sibling whose branch is open for the ordinary reason — nobody has
  // landed it — kept in the SAME run so the two marks are compared side
  // by side rather than in isolation.
  const SIBLING = "201-never-landed";
  const SIBLING_BRANCH = `aide/${SIBLING}`;

  // `resolveProject` only admits an archived spec's `specFolder` for
  // `archive` once `state.unlanded` names it, and that field is a side
  // effect of `archivedSpecRows` reading `ctx.peekUnlanded()` on a page
  // render — never of the background schedule alone. So this asks for
  // the list first, each time round, the same way the row-level
  // assertions below already have to poll for the mark to land.
  const enqueueArchiveWhenResolvable = async (base: string, specFolder: string): Promise<{ id: string }> => {
    const deadline = Date.now() + 3000;
    for (;;) {
      await fetch(`${base}/${ARCHIVED_VIEW}`, { headers: { "x-aide-token": TOKEN } });
      const res = await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder, steps: ["archive"] }),
      });
      if (res.ok) return ((await res.json()) as { job: { id: string } }).job;
      if (Date.now() > deadline) throw new Error(`${specFolder} never became resolvable for archive`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  test("carries BRANCH_LEFT_BEHIND's sentence in the notice line, distinct from NOT_LANDED's", async () => {
    // Matched by PATH SHAPE, not by comparing against a `dir` read off
    // `harness.start()`'s return value: the background schedule's very
    // first sweep runs SYNCHRONOUSLY inside `createServer`, before
    // `start()` returns anything to compare against, and its answer
    // then stands for the checker's own 30 s cache — so a check keyed
    // on a not-yet-known variable would silently poison the very cache
    // this test depends on.
    const isSpecsRoot = (dir: string) => dir.endsWith(join("aide", "specs"));
    const run = async (dir: string, args: string[]) => {
      const a = args.join(" ");
      // Both branches are on origin at the very first ask (step 1 of
      // `mergeBranchIntoDefault`) and stay listed by the open-branches
      // query for the whole test — the sibling because nothing ever
      // lands it, FOLDER because the delete below keeps failing. Only
      // the SPECS root is asked — the same shape every other fixture in
      // this file gives an archived spec's branch, and the one that
      // matters here: a `dir` this loop never merged (the code root)
      // must not ALSO claim to hold it, or the post-loop check would
      // (rightly, per the sibling test above) call this a genuine
      // failure instead of a left-behind delete.
      if (a.startsWith("ls-remote --exit-code")) return { code: 0, stdout: "" };
      if (a.startsWith("ls-remote --heads")) {
        if (isSpecsRoot(dir)) {
          return { code: 0, stdout: `sha1\trefs/heads/${BRANCH}\nsha2\trefs/heads/${SIBLING_BRANCH}\n` };
        }
        return { code: 0, stdout: "" };
      }
      if (isSpecsRoot(dir) && a === `push -q origin --delete ${BRANCH}`) {
        return { code: 1, stdout: "", stderr: "remote rejected: hook declined" };
      }
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("merge -q --ff-only origin/")) return { code: 0, stdout: "" };
      if (a.startsWith("merge -q --ff-only")) return { code: 0, stdout: "" };
      return { code: 0, stdout: "" };
    };
    const results = mkdtempSync(join(tmpdir(), "aide-archive-results-"));
    ownDirs.push(results);
    const { base, dir } = harness.start({
      archivedSpecs: { [FOLDER]: {}, [SIBLING]: {} },
      extra: {
        queueToken: TOKEN,
        gitRun: run as never,
        queueRunnerBin: "/usr/bin/true",
        queueResultDir: results,
      },
    });
    const specsRoot = join(dir, "root", "aide", "specs");

    const job = await enqueueArchiveWhenResolvable(base, FOLDER);
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({
        ok: true,
        exitCode: 0,
        costUsd: 0.1,
        costMeasured: true,
        terminalReason: "completed",
        branch: BRANCH,
        branchUrls: [{ root: specsRoot, url: "https://example.test/aide-specs" }],
        repos: [],
      }),
    );
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);
    expect(landed.error).toBeFalsy();

    const html = await listUntil(base, "could not be deleted on origin", ARCHIVED_VIEW);
    const row = rowFor(html, FOLDER);
    // REQ-1: the State cell says only the bare word now.
    expect(row).toContain('<span class="badge b-done">archived</span>');
    expect(row).not.toContain("branch left behind");
    expect(row).toContain(BRANCH);
    const block = blockFor(html, FOLDER);
    // REQ-3: git's own stderr — the actual `git push --delete` failure
    // reason — never reaches the row; a fixed sentence for a person
    // takes its place.
    expect(block).not.toContain("remote rejected: hook declined");
    expect(block).toContain("This spec merged, but its branch could not be deleted on origin. — Delete it by hand, in the checkout on the serving host.");

    // REQ-3: a sibling whose branch never landed at all still reads
    // exactly as it always has — no reason recorded for it, so it falls
    // through to the plain mark rather than picking up FOLDER's.
    const siblingRow = rowFor(html, SIBLING);
    expect(siblingRow).toContain('<span class="badge b-done">archived</span>');
    const siblingBlock = blockFor(html, SIBLING);
    expect(siblingBlock).toContain("its branch is still on origin — re-run archive");
    expect(siblingBlock).not.toContain("This spec merged, but its branch could not be deleted");
  }, 15000);
});
