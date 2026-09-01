import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRootLock,
} from "../../src/serve/serve.ts";
import { type GitRunner } from "../../src/git/branch-status.ts";
import { installAfterMerge, restartAfterLanding, type LandContext, type RestartHook } from "../../src/serve/land-branch.ts";
import type { RepoMergeResult } from "../../src/git/branch-merge.ts";
import { statusSaying } from "../helpers/queue-server.ts";
import {
  TOKEN,
  setupQueueRoutesHarness,
} from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
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
    // The lead is the analyze job that is STILL LANDING, not the newer
    // cancelled decoy: the page says so by disabling Reset for exactly
    // that reason, and by counting the analyze job's one step. A page
    // that had taken the decoy as lead would offer Reset and know
    // nothing of a landing.
    expect(html).toContain('title="a landing is in progress">Reset</span>');
    expect(html).toContain("Logs (1)");
    expect(html.slice(html.indexOf("<body"))).not.toContain("cancelled");

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
    expect(failed).rejects.toThrow("git blew up");
    expect(await lock.run("/repo", async () => "fine")).toBe("fine");
  });
});

// Spec 287: `install-after-merge.sh` used to fire `launchctl kickstart -k`
// unconditionally the instant it finished, killing whatever OTHER landing
// (any repo root, including the one about to be restarted into) was still
// mid-`git push`. The restart now lives here, gated on `mergeLock` — the
// one shared signal for "a merge is in flight anywhere" — before it is
// allowed to fire.
describe("the restart waits for landings elsewhere to clear (spec 287)", () => {
  function restartSpy(registered = true) {
    let fired = 0;
    const hook: RestartHook = {
      registered: async () => registered,
      fire: () => {
        fired += 1;
      },
    };
    return { hook, count: () => fired };
  }

  test("does not fire while a DIFFERENT root is still busy (criterion 1)", async () => {
    const lock = createRootLock();
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    const held = lock.run("/repos/other-project", () => gate);
    const { hook, count } = restartSpy();

    const waiting = restartAfterLanding({ mergeLock: lock, restart: hook, restartPollMs: 5, restartDeferTimeoutMs: 500 });
    await new Promise((r) => setTimeout(r, 30));
    expect(count()).toBe(0);

    release();
    await held;
    await waiting;
    expect(count()).toBe(1);
  });

  test("fires exactly once, with no further delay, once the held root clears (criterion 2)", async () => {
    const lock = createRootLock();
    const held = lock.run("/repos/other-project", () => new Promise((r) => setTimeout(r, 20)));
    const { hook, count } = restartSpy();

    await restartAfterLanding({ mergeLock: lock, restart: hook, restartPollMs: 5, restartDeferTimeoutMs: 500 });
    await held;
    expect(count()).toBe(1);
  });

  test("does not fire while the SAME root it is about to restart into is busy (criterion 7)", async () => {
    const lock = createRootLock();
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    // The exact shape 2-analysis.md's REQ-4 finding 1 describes: the
    // server's own checkout being rewritten by a concurrent merge at
    // restart time.
    const held = lock.run("/repos/aide-code", () => gate);
    const { hook, count } = restartSpy();

    const waiting = restartAfterLanding({ mergeLock: lock, restart: hook, restartPollMs: 5, restartDeferTimeoutMs: 500 });
    await new Promise((r) => setTimeout(r, 30));
    expect(count()).toBe(0);

    release();
    await held;
    await waiting;
    expect(count()).toBe(1);
  });

  test("past the deadline it restarts anyway, logging the busy root first (criterion 5)", async () => {
    const lock = createRootLock();
    const held = lock.run("/repos/never-clears", () => new Promise(() => {}));
    const { hook, count } = restartSpy();
    const logged: string[] = [];
    const realError = console.error;
    console.error = (msg: unknown) => {
      logged.push(String(msg));
    };
    try {
      await restartAfterLanding({ mergeLock: lock, restart: hook, restartPollMs: 5, restartDeferTimeoutMs: 30 });
    } finally {
      console.error = realError;
    }
    expect(count()).toBe(1);
    expect(logged.some((l) => l.includes("/repos/never-clears"))).toBe(true);
    void held;
  });

  test("stays silent about a busy root when nothing was busy, but still announces the restart (criterion 6)", async () => {
    const lock = createRootLock();
    const { hook, count } = restartSpy();
    const logged: string[] = [];
    const realError = console.error;
    console.error = (msg: unknown) => {
      logged.push(String(msg));
    };
    try {
      await restartAfterLanding({ mergeLock: lock, restart: hook, restartPollMs: 5, restartDeferTimeoutMs: 500 });
    } finally {
      console.error = realError;
    }
    expect(count()).toBe(1);
    // The busy-root warning (criterion 5) is what criterion 6 is about
    // — the ordinary restart still logs, since the success path used to
    // be silent everywhere, and that made a restart that quietly
    // stopped firing indistinguishable from one that never had to.
    expect(logged).toEqual(["queue: restarting the dashboard to pick up a landed code change"]);
  });

  test("never fires when nothing is registered to restart — the laptop/test-default case", async () => {
    const lock = createRootLock();
    const held = lock.run("/repos/other-project", () => new Promise(() => {}));
    const { hook, count } = restartSpy(false);
    await restartAfterLanding({ mergeLock: lock, restart: hook, restartPollMs: 5, restartDeferTimeoutMs: 500 });
    expect(count()).toBe(0);
    void held;
  });

  // Criterion 4 (REQ-2): a failed install must skip the restart entirely,
  // matching `set -e`'s old behavior of never reaching the restart block
  // on an earlier failure.
  test("installAfterMerge skips the restart when the install itself fails (criterion 4)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-287-install-fail-"));
    ownDirs.push(dir);
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(join(dir, ".aide", "config"), "AIDE_INSTALL_CMD=/bin/false\n");
    const lock = createRootLock();
    const { hook, count } = restartSpy();
    const ctx = {
      mergeLock: lock,
      restart: hook,
      restartPollMs: 5,
      restartDeferTimeoutMs: 500,
      queueInstallTimeoutMs: undefined,
    } as unknown as LandContext;
    const result: RepoMergeResult = { root: dir, ok: true };

    await installAfterMerge(ctx, result);

    expect(result.installError).toBeTruthy();
    expect(count()).toBe(0);
  });

  test("installAfterMerge restarts once a successful install clears (companion to criterion 4)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-287-install-ok-"));
    ownDirs.push(dir);
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(join(dir, ".aide", "config"), "AIDE_INSTALL_CMD=/usr/bin/true\n");
    const lock = createRootLock();
    const { hook, count } = restartSpy();
    const ctx = {
      mergeLock: lock,
      restart: hook,
      restartPollMs: 5,
      restartDeferTimeoutMs: 500,
      queueInstallTimeoutMs: undefined,
    } as unknown as LandContext;
    const result: RepoMergeResult = { root: dir, ok: true };

    await installAfterMerge(ctx, result);

    expect(result.installError).toBeUndefined();
    expect(count()).toBe(1);
  });
});

// Criterion 3 (REQ-2): the restart trigger lives only in
// `dashboard/src/serve/land-branch/restart.ts` now — a text-level guard
// that the script it moved out of never regains it by accident.
describe("install-after-merge.sh no longer restarts anything itself (spec 287)", () => {
  test("the script does not contain launchctl kickstart", () => {
    const script = readFileSync(join(import.meta.dir, "..", "..", "deploy", "install-after-merge.sh"), "utf-8");
    expect(script).not.toContain("launchctl kickstart");
  });
});
