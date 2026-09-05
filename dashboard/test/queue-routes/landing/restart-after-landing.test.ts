// The restart a landing asks for: it waits for every landing elsewhere
// to clear first, it is asked for rather than fired from inside the
// merge loop, and install-after-merge.sh no longer fires one itself.
//
// Split out of landing-window-and-repo-lock.test.ts 2026-09-04; the
// tests are unchanged and keep their names.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRootLock,
} from "../../../src/serve/serve.ts";
import { installAfterMerge, restartAfterLanding, runningJobIds, type LandContext, type RestartHook } from "../../../src/serve/land-branch.ts";
import type { RepoMergeResult } from "../../../src/git/branch-merge.ts";

/** The message a landing carries, as text: since spec 380 it is
 *  stored as WHICH message and what fills its blanks, and the
 *  reader composes it. */
import { renderSentence } from "../../../src/i18n/message.ts";

function sentence(s: unknown): string {
  return renderSentence("en", s as Parameters<typeof renderSentence>[1]) ?? "";
}

import {
  setupQueueRoutesHarness,
} from "../fixtures.ts";

const { harness } = setupQueueRoutesHarness();

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

  /** Samples `check()` every `stepMs`, across a bounded `totalMs`
   *  window, instead of sleeping once and asserting once — so a
   *  regression that fires early is caught the moment a sample sees
   *  it, not only if it happens to land on one single, fixed-delay
   *  sample racing the same event loop's other pending timers. */
  async function assertHoldsFor(totalMs: number, stepMs: number, check: () => void): Promise<void> {
    for (let waited = 0; waited < totalMs; waited += stepMs) {
      await new Promise((r) => setTimeout(r, stepMs));
      check();
    }
  }

  test("does not fire while a DIFFERENT root is still busy (criterion 1)", async () => {
    const lock = createRootLock();
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    const held = lock.run("/repos/other-project", () => gate);
    const { hook, count } = restartSpy();

    const waiting = restartAfterLanding({ mergeLock: lock, restart: hook, restartPollMs: 5, restartDeferTimeoutMs: 500 });
    await assertHoldsFor(30, 5, () => expect(count()).toBe(0));

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
    await assertHoldsFor(30, 5, () => expect(count()).toBe(0));

    release();
    await held;
    await waiting;
    expect(count()).toBe(1);
  });

  test("waits while another job is running, then fires once it is done", async () => {
    // A running job's process dies with the server, and the queue keeps
    // saying "running" about it for hours (00:13, 2026-09-03). The
    // landing job itself is exempt: it is the one asking.
    const jobs = [
      { id: "landing-job", state: "running" },
      { id: "other-job", state: "running" },
    ];
    const { hook, count } = restartSpy();
    const waiting = restartAfterLanding({
      mergeLock: createRootLock(),
      restart: hook,
      restartPollMs: 5,
      restartJobsDeferMs: 500,
      queue: { list: () => jobs },
      exceptJobId: "landing-job",
    });
    await assertHoldsFor(30, 5, () => expect(count()).toBe(0));

    jobs[1]!.state = "done";
    await waiting;
    expect(count()).toBe(1);
  });

  test("only the landing job running is no reason to wait", async () => {
    const { hook, count } = restartSpy();
    await restartAfterLanding({
      mergeLock: createRootLock(),
      restart: hook,
      restartPollMs: 5,
      restartJobsDeferMs: 500,
      queue: { list: () => [{ id: "landing-job", state: "running" }] },
      exceptJobId: "landing-job",
    });
    expect(count()).toBe(1);
  });

  test("past the jobs deadline it restarts anyway, naming the job", async () => {
    const { hook, count } = restartSpy();
    const logged: string[] = [];
    const realError = console.error;
    console.error = (msg: unknown) => {
      logged.push(String(msg));
    };
    try {
      await restartAfterLanding({
        mergeLock: createRootLock(),
        restart: hook,
        restartPollMs: 5,
        restartJobsDeferMs: 30,
        queue: { list: () => [{ id: "never-done-job", state: "running" }] },
      });
    } finally {
      console.error = realError;
    }
    expect(count()).toBe(1);
    expect(logged.some((l) => l.includes("never-do"))).toBe(true);
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
  // on an earlier failure. It says so by ANSWERING "no restart" — the
  // firing itself belongs to the caller now, so that the loop landing
  // several repos is not killed between two of them.
  test("installAfterMerge answers no-restart when the install itself fails (criterion 4)", async () => {
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

    const wantsRestart = await installAfterMerge(ctx, result);

    expect(result.installError).toBeTruthy();
    expect(wantsRestart).toBe(false);
    expect(count()).toBe(0);
  });

  // Spec 318 (REQ-1): the post-merge note names the setting in plain
  // words, not the raw env-var key.
  test("installAfterMerge names the setting in plain words when none is configured (REQ-1)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-318-install-unset-"));
    ownDirs.push(dir);
    mkdirSync(join(dir, ".aide"), { recursive: true });
    const lock = createRootLock();
    const { hook } = restartSpy();
    const ctx = {
      mergeLock: lock,
      restart: hook,
      restartPollMs: 5,
      restartDeferTimeoutMs: 500,
      queueInstallTimeoutMs: undefined,
    } as unknown as LandContext;
    const result: RepoMergeResult = { root: dir, ok: true };

    await installAfterMerge(ctx, result);

    expect(sentence(result.installError)).toContain("install command");
    expect(sentence(result.installError)).not.toContain("AIDE_INSTALL_CMD");
  });

  // The companion to criterion 4, rewritten around the ownership move:
  // a successful install ASKS for the restart and never fires one. It
  // used to fire here, from inside `landBranch`'s per-repo loop, which
  // killed the process before archive's specs root was merged.
  test("installAfterMerge asks for a restart on success, and fires none itself", async () => {
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

    const wantsRestart = await installAfterMerge(ctx, result);

    expect(result.installError).toBeUndefined();
    expect(wantsRestart).toBe(true);
    expect(count()).toBe(0);
  });
});

// Spec 385: nothing before this told anything outside `restartAfterLanding`
// itself when a wait started, changed, or ended — the Deploy tab had no
// signal to draw a "waiting" sentence from. `onJobsWaitChange` is that
// signal, and `runningJobIds` is the check both this loop and the deploy
// route need to make independently, without disagreeing on what a
// running-job list means.
describe("runningJobIds (spec 385)", () => {
  test("lists running jobs' short ids, excluding the one named", () => {
    const queue = {
      list: () => [
        { id: "abcdef12-full", state: "running" },
        { id: "landing-job", state: "running" },
        { id: "done-job", state: "done" },
      ],
    };
    expect(runningJobIds(queue, "landing-job")).toEqual(["abcdef12"]);
  });

  test("with no exceptJobId, every running job counts", () => {
    const queue = { list: () => [{ id: "job-one", state: "running" }, { id: "job-two", state: "queued" }] };
    expect(runningJobIds(queue)).toEqual(["job-one"]);
  });

  test("no queue at all is no running jobs", () => {
    expect(runningJobIds(undefined)).toEqual([]);
  });
});

describe("onJobsWaitChange (spec 385)", () => {
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

  test("called with the running snapshot the moment a wait starts, and again with [] once it clears", async () => {
    const jobs = [
      { id: "landing-job", state: "running" },
      { id: "other-job", state: "running" },
    ];
    const { hook } = restartSpy();
    const seen: string[][] = [];
    const waiting = restartAfterLanding({
      mergeLock: createRootLock(),
      restart: hook,
      restartPollMs: 5,
      restartJobsDeferMs: 500,
      queue: { list: () => jobs },
      exceptJobId: "landing-job",
      onJobsWaitChange: (j) => seen.push(j),
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(seen[0]).toEqual(["other-jo"]);

    jobs[1]!.state = "done";
    await waiting;
    expect(seen[seen.length - 1]).toEqual([]);
  });

  test("called with [] immediately when nothing is registered to restart", async () => {
    const { hook } = restartSpy(false);
    const seen: string[][] = [];
    await restartAfterLanding({
      mergeLock: createRootLock(),
      restart: hook,
      restartPollMs: 5,
      onJobsWaitChange: (j) => seen.push(j),
    });
    expect(seen).toEqual([[]]);
  });

  test("called with [] right before firing, once the jobs deadline is exceeded with a job still stuck", async () => {
    const { hook, count } = restartSpy();
    const seen: string[][] = [];
    await restartAfterLanding({
      mergeLock: createRootLock(),
      restart: hook,
      restartPollMs: 5,
      restartJobsDeferMs: 30,
      queue: { list: () => [{ id: "never-done-job", state: "running" }] },
      onJobsWaitChange: (j) => seen.push(j),
    });
    expect(count()).toBe(1);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toEqual([]);
  });
});

// Criterion 3 (REQ-2): the restart trigger lives only in
// `dashboard/src/serve/land-branch/restart.ts` now — a text-level guard
// that the script it moved out of never regains it by accident.
describe("install-after-merge.sh no longer restarts anything itself (spec 287)", () => {
  test("the script does not contain launchctl kickstart", () => {
    const script = readFileSync(join(import.meta.dir, "..", "..", "..", "deploy", "install-after-merge.sh"), "utf-8");
    expect(script).not.toContain("launchctl kickstart");
  });
});
