import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ServerOptions } from "../../src/serve/serve.ts";
import { TOKEN, setupQueueRoutesHarness } from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

// --- spec 187: a stopped step keeps its work --------------------------------
//
// Split out of stopped-and-every-step.test.ts by theme — the rest of
// that file is "every step lands its own work (spec 149)", split
// across every-step-basic-landing.test.ts, every-step-origin-recheck.test.ts
// and every-step-pull-request.test.ts.
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
