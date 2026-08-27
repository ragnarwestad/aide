import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ServerOptions,
} from "../../src/serve/serve.ts";
import { statusSaying } from "../helpers/queue-server.ts";
import {
  TOKEN,
  specHead,
  specControls,
  OPEN_81,
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
