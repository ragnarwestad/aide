// Split out of step-and-dependency-routes.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOKEN, OPEN_81, setupQueueRoutesHarness } from "./fixtures.ts";

const { harness } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

// --- spec 122: a queued step waits for its dependency, it does not fail -----
//
// Before this, a queued implement whose dependency was still unmerged
// started, was refused by `aide-run-spec`, and landed in `failed` — a
// state nothing retries. The queue now asks the same question the script
// asks (is the dependency's branch merged on origin?) BEFORE spawning
// anything, and leaves the job queued with the reason on its row until
// the answer changes.
describe("a job parked on an unmerged dependency (spec 122)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const DEPENDENT = "# Queue - Description\n\n## Tracking info\n\n- **Depends on:** `80-dependency`\n";

  /** A projects root this suite owns, so the paths git is asked about
   *  are the paths the test names. The shared harness makes its own and
   *  leaves `queueProjectRoot` unset, which resolves the project's
   *  checkout to a bare relative name — fine for a suite that never
   *  looks at it, useless for one that is entirely about which repo was
   *  asked. */
  function root(dir: string): { root: string; project: string; specs: string } {
    const projectsRoot = join(dir, "root");
    const project = join(projectsRoot, "aide");
    const specs = join(project, "specs");
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\n");
    mkdirSync(join(specs, "81-queue-and-runner"), { recursive: true });
    writeFileSync(join(specs, "81-queue-and-runner", "1-description.md"), DEPENDENT);
    // `analyze` already on the line: this suite is about the DEPENDENCY
    // gate, and a job parked by spec 344's own analyze gate instead would
    // make every assertion below about the dependency's name fail for an
    // unrelated reason.
    writeFileSync(
      join(specs, "81-queue-and-runner", "4-status.md"),
      "# Queue - Status\n\n## Tracking info\n\n- **Workflow steps completed:** analyze\n",
    );
    mkdirSync(join(specs, "80-dependency"), { recursive: true });
    writeFileSync(join(specs, "80-dependency", "1-description.md"), "# 80-dependency\n");
    return { root: projectsRoot, project, specs };
  }

  /** A stub runner that records the argv it was called with — the same
   *  shape "the runner invocation" uses. The proof that nothing was
   *  spawned is that this file never appears. */
  function stub(dir: string): { bin: string; argvFile: string } {
    const argvFile = join(dir, "runner-argv.txt");
    const bin = join(dir, "fake-run-spec");
    writeFileSync(bin, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > ${argvFile}\n`, { mode: 0o755 });
    return { bin, argvFile };
  }

  /** A git that answers `isMerged` per repo root. `unmerged` names the
   *  roots where the dependency's branch still has commits of its own;
   *  everywhere else it is an ancestor of the default branch. Read
   *  through a function, so one test can watch the answer change under a
   *  live server. */
  function gitFor(unmerged: () => string[]) {
    const calls: { dir: string; args: string[] }[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      // The branch IS on origin — absence is the other way a dependency
      // counts as merged, and this suite is about the ancestry answer.
      if (a.startsWith("ls-remote")) return { code: 0, stdout: "abc123\trefs/heads/x\n" };
      if (a.startsWith("merge-base --is-ancestor")) {
        return { code: unmerged().includes(dir) ? 1 : 0, stdout: "" };
      }
      return { code: 0, stdout: "" };
    };
    return { run, calls };
  }

  const queueImplement = (base: string) =>
    fetch(`${base}/api/queue`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"] }),
    });

  /** Long enough for a spawn to have written its file: the runner ticks
   *  on the enqueue itself, so a job that was going to start has started
   *  well before this returns. */
  const settle = () => Bun.sleep(400);

  function own(prefix: string) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    ownDirs.push(dir);
    return dir;
  }

  test("an implement job whose dependency is unmerged never invokes the runner", async () => {
    const dir = own("aide-queue-parked-");
    const { bin, argvFile } = stub(dir);
    const paths = root(dir);
    const git = gitFor(() => [paths.project, paths.specs]);
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        queueRunnerBin: bin,
        queueResultDir: join(dir, "jobs"),
        gitRun: git.run,
      },
    });
    expect((await queueImplement(base)).status).toBe(200);
    await settle();
    expect(existsSync(argvFile)).toBe(false);

    const listed = (await (await fetch(`${base}/api/queue`, { headers: AUTH })).json()) as {
      jobs: { state: string; error?: string }[];
    };
    expect(listed.jobs[0].state).toBe("queued");
    expect(listed.jobs[0].error).toContain("80-dependency");
  });

  test("a dependency merged in one root but not the other still parks the job", async () => {
    const dir = own("aide-queue-parked-two-");
    const { bin, argvFile } = stub(dir);
    const paths = root(dir);
    // Merged in the project checkout, still open in the specs repo.
    const git = gitFor(() => [paths.specs]);
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        queueRunnerBin: bin,
        queueResultDir: join(dir, "jobs"),
        gitRun: git.run,
      },
    });
    expect((await queueImplement(base)).status).toBe(200);
    await settle();
    expect(existsSync(argvFile)).toBe(false);
    // Both roots were actually asked — a check that stopped at the
    // project would have started this job.
    expect(git.calls.some((c) => c.dir === paths.project)).toBe(true);
    expect(git.calls.some((c) => c.dir === paths.specs)).toBe(true);
  });

  // Spec 213. The two tests above and the three-server test below both
  // read ONE answer; this one is about how old that answer may be. Two
  // jobs were released roughly half a minute before their dependency
  // finished archiving: the gate ran fresh every 2 s, but the merge
  // answer under it stood for 30 s, so a "merged" taken before the
  // dependency landed was handed out for the rest of that window.
  //
  // One server across several real ticks, deliberately — the point is
  // the same `BranchStatusChecker` instance being asked again inside
  // its own TTL, which is exactly what the three-server test below was
  // built to avoid needing.
  test("the gate re-asks origin on every tick, and releases the job the tick its dependency lands", async () => {
    const dir = own("aide-queue-gate-fresh-");
    const { bin, argvFile } = stub(dir);
    const paths = root(dir);
    let unmerged = [paths.project, paths.specs];
    const git = gitFor(() => unmerged);
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        queueRunnerBin: bin,
        queueResultDir: join(dir, "jobs"),
        gitRun: git.run,
      },
    });
    expect((await queueImplement(base)).status).toBe(200);
    await settle();
    const asked = () => git.calls.filter((c) => c.args[0] === "merge-base").length;
    const first = asked();
    expect(first).toBeGreaterThan(0);

    // One 2 s tick interval plus margin, well inside the 30 s TTL: the
    // question has to have been put to git again. Cached, this count
    // would not move for another 28 seconds.
    await Bun.sleep(2500);
    expect(asked()).toBeGreaterThan(first);
    expect(existsSync(argvFile)).toBe(false);

    // The dependency lands. The job starts on the next tick — not when
    // a cache happens to expire.
    unmerged = [];
    for (let i = 0; i < 50 && !existsSync(argvFile); i++) await Bun.sleep(100);
    expect(existsSync(argvFile)).toBe(true);
  }, 20000);
  // Criterion 10 (spec 149). The gate's code is unchanged, but what
  // satisfies it has moved: a dependency's ANALYZE lands itself now, so
  // its specs-repo branch merges early — and that must not read as "the
  // dependency is done". Only the ARCHIVE that lands its code releases a
  // dependent, because since spec 149 that is the only point a spec's
  // code branch reaches a default branch at all.
  //
  // Three servers over one mirror, rather than one server watching the
  // answer change: each merge answer is cached for 30 s, and this test
  // is about which ANSWER releases the job, not about when a cache
  // expires.
  test("only the dependency's archive releases the parked job — its analyze does not", async () => {
    const dir = own("aide-queue-release-");
    const paths = root(dir);
    const mirror = join(dir, "queue.json");
    const common = {
      queueToken: TOKEN,
      projectRoot: paths.root,
      queueProjectRoot: paths.root,
      queueMirrorPath: mirror,
    };

    // The dependency's own finished job, recorded through a server with
    // no runner: it must leave a branch behind without ever running.
    const { base: seeder } = harness.start({
      extra: { ...common, gitRun: gitFor(() => [paths.project, paths.specs]).run },
    });
    const dep = (await (
      await fetch(`${seeder}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: "80-dependency", steps: ["analyze"] }),
      })
    ).json()) as { job: { id: string } };
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const stored = jobs.find((j) => j.id === dep.job.id)!;
    stored.state = "done";
    stored.branchUrls = [
      { root: paths.project, url: "https://example.test/aide" },
      { root: paths.specs, url: "https://example.test/aide-specs" },
    ];
    writeFileSync(mirror, JSON.stringify(jobs));

    /** One server's answer to "does this dependent start?", with the
     *  dependency's branch merged in exactly the named roots. `waitMs`
     *  is how long to give it: a refused enqueue does not tick the
     *  runner, so a job already in the mirror waits for the server's own
     *  2 s interval — worth waiting out when a start is expected, worth
     *  not waiting out three times over when one is not. */
    async function startsWith(unmerged: string[], prefix: string, waitMs = 800): Promise<boolean> {
      const runDir = own(prefix);
      const { bin, argvFile } = stub(runDir);
      const { base } = harness.start({
        extra: {
          ...common,
          queueRunnerBin: bin,
          queueResultDir: join(runDir, "jobs"),
          gitRun: gitFor(() => unmerged).run,
        },
      });
      const posted = await queueImplement(base);
      // The dependent's own job is enqueued once and lives in the shared
      // mirror; a later server finds it already there and refuses a
      // second copy, which is not what this test is asking about.
      expect([200, 400]).toContain(posted.status);
      for (let i = 0; i * 100 < waitMs && !existsSync(argvFile); i++) await Bun.sleep(100);
      return existsSync(argvFile);
    }

    // Nothing landed: parked, as spec 122 already had it.
    expect(await startsWith([paths.project, paths.specs], "aide-queue-release-none-")).toBe(false);
    // The dependency's analyze self-landed — the specs repo is merged
    // and the code is not. Still parked.
    expect(await startsWith([paths.project], "aide-queue-release-analyzed-")).toBe(false);
    // Archived: the code landed too, and the dependent starts.
    expect(await startsWith([], "aide-queue-release-archived-", 6000)).toBe(true);
  }, 20000);

  test("a parked job's row shows the queued badge and the reason it is held back", async () => {
    const dir = own("aide-queue-parked-row-");
    const { bin } = stub(dir);
    const paths = root(dir);
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        queueRunnerBin: bin,
        queueResultDir: join(dir, "jobs"),
        gitRun: gitFor(() => [paths.project, paths.specs]).run,
      },
    });
    expect((await queueImplement(base)).status).toBe(200);
    await settle();
    const html = await (
      await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    // The ordinary queued badge, with the reason underneath it — no
    // seventh badge variant and no new job state were introduced.
    expect(html).toContain('badge b-idle">queued');
    expect(html).toContain("held back: depends on 80-dependency");
  });

  test("cancelling a parked job cancels it like any other queued job", async () => {
    const dir = own("aide-queue-parked-cancel-");
    const { bin } = stub(dir);
    const paths = root(dir);
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        queueRunnerBin: bin,
        queueResultDir: join(dir, "jobs"),
        gitRun: gitFor(() => [paths.project, paths.specs]).run,
      },
    });
    const made = (await (await queueImplement(base)).json()) as { job: { id: string } };
    await settle();
    expect((await fetch(`${base}/api/queue/${made.job.id}/cancel`, { method: "POST", headers: AUTH })).status)
      .toBe(200);
    const after = (await (await fetch(`${base}/api/queue`, { headers: AUTH })).json()) as {
      jobs: { id: string; state: string }[];
    };
    expect(after.jobs.find((j) => j.id === made.job.id)?.state).toBe("cancelled");
  });

  // --- spec 344: the same park, one question earlier -------------------------
  //
  // `blockedForMissingAnalyze()` rather than `blockedDependencies()` —
  // asked before a job is spawned, the same shape as the dependency park
  // above.
  describe("a job parked on its own missing analyze step (spec 344)", () => {
    /** `root()` minus the dependency: no "Depends on:" line and no
     *  `4-status.md` at all, so only the analyze gate is in play. */
    function rootWithoutAnalyze(dir: string): { root: string; project: string; specs: string } {
      const paths = root(dir);
      writeFileSync(join(paths.specs, "81-queue-and-runner", "1-description.md"), "# Queue - Description\n");
      rmSync(join(paths.specs, "81-queue-and-runner", "4-status.md"));
      return paths;
    }

    test("an implement job whose spec has not been analyzed never invokes the runner", async () => {
      const dir = own("aide-queue-parked-analyze-");
      const { bin, argvFile } = stub(dir);
      const paths = rootWithoutAnalyze(dir);
      const { base } = harness.start({
        extra: {
          queueToken: TOKEN,
          projectRoot: paths.root,
          queueProjectRoot: paths.root,
          queueRunnerBin: bin,
          queueResultDir: join(dir, "jobs"),
          gitRun: gitFor(() => []).run,
        },
      });
      expect((await queueImplement(base)).status).toBe(200);
      await settle();
      expect(existsSync(argvFile)).toBe(false);

      const listed = (await (await fetch(`${base}/api/queue`, { headers: AUTH })).json()) as {
        jobs: { state: string; error?: string }[];
      };
      expect(listed.jobs[0].state).toBe("queued");
      expect(listed.jobs[0].error).toBe("held back: not analyzed yet — run /aide-analyze first");
    });

    test("the job proceeds once analyze is on the line", async () => {
      const dir = own("aide-queue-released-analyze-");
      const { bin, argvFile } = stub(dir);
      const paths = rootWithoutAnalyze(dir);
      const { base } = harness.start({
        extra: {
          queueToken: TOKEN,
          projectRoot: paths.root,
          queueProjectRoot: paths.root,
          queueRunnerBin: bin,
          queueResultDir: join(dir, "jobs"),
          gitRun: gitFor(() => []).run,
        },
      });
      expect((await queueImplement(base)).status).toBe(200);
      await settle();
      expect(existsSync(argvFile)).toBe(false);

      writeFileSync(
        join(paths.specs, "81-queue-and-runner", "4-status.md"),
        "# Queue - Status\n\n## Tracking info\n\n- **Workflow steps completed:** analyze\n",
      );
      for (let i = 0; i < 50 && !existsSync(argvFile); i++) await Bun.sleep(100);
      expect(existsSync(argvFile)).toBe(true);
    });
  });
});
