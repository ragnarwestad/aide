// Nothing slow happens while a page is being drawn.
//
// Three fixes had been made for this, one page each — one never
// merged, one for /projects, and then a third put a
// network `ls-remote` straight back onto the spec list's render path
// the next day. The /projects pattern is applied to the
// whole app here: every checker gains a synchronous `peek*`, and ONE
// background schedule keeps them all fed.
//
// This suite is about that schedule — what it asks, of whom, how often
// and how concurrently. The peeks themselves are tested next to the
// checkers that own them; what the pages do with the answers is tested
// in `queue-routes.test.ts`.

import { afterEach, describe, expect, test } from "bun:test";
import { queueHarness } from "../helpers/queue-server.ts";
import { type GitCall } from "../helpers/fake-git.ts";
import type { GitRunner } from "../../src/git/process/index.ts";
import { BranchStatusChecker } from "../../src/git/branch-status.ts";
import { refreshSpecCaches, rereadSpec, type ScheduleContext } from "../../src/serve/schedules";
import { firstSweepMark } from "../../src/serve/schedules/first-sweep.ts";
import { createScheduleStore } from "../../src/queue/schedule-store.ts";
import type { QueueStore } from "../../src/queue/queue.ts";
import type { GhRunner, PullRequestAnswer } from "../../src/integrations/pull-requests.ts";
import type { CheckoutEnsurer } from "../../src/git/checkout-ensurer.ts";
import type { WorkflowHistoryChecker, BranchFileStepsChecker } from "../../src/git/workflow-history.ts";
import type {
  DescriptionFreshnessChecker, SpecCreatedAtChecker, SpecFileCommitChecker,
} from "../../src/git/description-freshness.ts";

const harness = queueHarness("aide-cache-warmer-");

afterEach(() => harness.cleanup());

/** A runner that records everything and answers plausibly for every
 *  question the warmer asks. `hold` lets a case keep calls in flight,
 *  which is how concurrency and tick overlap are observed without a
 *  clock. */
function recordingGit(opts: { hold?: (args: string[]) => Promise<void> } = {}) {
  const calls: GitCall[] = [];
  let inFlight = 0;
  let peakInFlight = 0;
  const run: GitRunner = async (dir, args) => {
    calls.push({ dir, args });
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    try {
      if (opts.hold) await opts.hold(args);
      const line = args.join(" ");
      if (args[0] === "ls-remote") {
        return {
          code: 0,
          stdout: "a3f9c21deadbeef0000000000000000000000000\trefs/heads/aide/81-queue-and-runner\n",
        };
      }
      if (line.startsWith("log --format=%aI")) return { code: 0, stdout: "2026-08-17T09:00:00+02:00\n" };
      if (line.startsWith("log -1 --format=%H")) {
        return { code: 0, stdout: "deadbee\t2026-08-18T09:10:36+02:00\n" };
      }
      if (line.startsWith("log --all")) return { code: 0, stdout: "Run /aide-analyze for 81-queue-and-runner (headless)\n" };
      // A landing merges in a worktree of its own, so `worktree add` is
      // on the happy path of every merge — unanswered it fails, and the
      // landing refuses before it has done anything.
      if (args[0] === "worktree") return { code: 0, stdout: "" };
      return { code: 1, stdout: "" };
    } finally {
      inFlight -= 1;
    }
  };
  return { run, calls, peak: () => peakInFlight };
}

/** The calls the SPEC-CACHE warmer makes, and only those. The server
 *  also clones its own checkouts and asks each project whether a run
 *  could start there; counting every call would make this suite about
 *  those instead. */
const warmerCalls = (calls: GitCall[]) =>
  calls.filter((c) => c.args[0] === "log" || c.args[0] === "ls-remote");

const lsRemotes = (calls: GitCall[]) => calls.filter((c) => c.args[0] === "ls-remote");

/** Wait until `check` holds, or give up — the same bounded-loop idiom
 *  `projects-route.test.ts` uses for the drift poll, never an open-
 *  ended wait. */
async function until(check: () => boolean, budgetMs = 2000): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return check();
}

/** Wait until a count stops growing — one tick's worth of work is over.
 *  Bounded, like `until`. */
async function settled(count: () => number, quietMs = 60, budgetMs = 2000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  let last = -1;
  while (Date.now() < deadline) {
    const seen = count();
    await new Promise((r) => setTimeout(r, quietMs));
    if (count() === seen && seen === last) return;
    last = seen;
  }
}

describe("refreshSpecCaches — the one schedule that feeds every peek", () => {
  test("one tick fills every checker for the live spec and the archived spec's root", async () => {
    const git = recordingGit();
    harness.start({
      extra: { gitRun: git.run, driftPollMs: 0, specCachePollMs: 25 },
      archivedSpecs: { "77-old-thing": {} },
    });
    // The workflow history, the created-at date, the description's
    // freshness and the four file stamps — every question the spec list
    // and the spec page ask.
    await until(() => git.calls.some((c) => c.args.join(" ").startsWith("log --all")));
    await until(() => git.calls.some((c) => c.args.join(" ").startsWith("log --format=%aI")));
    await until(() =>
      git.calls.some((c) => c.args.join(" ").includes("-- 3-solution.md")),
    );
    // And, for the archived spec, the network question.
    expect(await until(() => lsRemotes(git.calls).length > 0)).toBe(true);
  });

  test("no archived spec is warmed as if it were live", async () => {
    const git = recordingGit();
    harness.start({
      extra: { gitRun: git.run, driftPollMs: 0, specCachePollMs: 25 },
      archivedSpecs: { "77-old-thing": {} },
    });
    await until(() => lsRemotes(git.calls).length > 0);
    await until(() => git.calls.some((c) => c.args.join(" ").startsWith("log --follow --format=%aI")));
    // The per-spec sweep walks `targets()`, which is the LIVE list. An
    // archived spec is asked only its OWN two questions — the archive
    // date (only where `4-status.md` carries no stamp) and its own
    // creation date via the rename-aware lookup — and
    // never the four the live sweep asks. Warming every spec that ever
    // existed, forever, is a cost a plan review
    // rejected.
    const inArchive = git.calls.filter((c) => c.dir.includes("archive"));
    expect(inArchive.some((c) => c.args.join(" ").startsWith("log --all"))).toBe(false);
    // The LIVE staleness check's shape specifically — `lastCommitAt`'s
    // `log -1 ...` — not the rename-aware `--follow` lookup below, which
    // also names `1-description.md` now that the fix lands.
    expect(
      inArchive.some(
        (c) => c.args.join(" ").startsWith("log -1 --format=") && c.args.join(" ").includes("-- 1-description.md"),
      ),
    ).toBe(false);
    // Not the LIVE creation-date lookup (a directory pathspec) — the
    // rename-aware one, which is a different call entirely.
    expect(inArchive.some((c) => c.args.join(" ") === "log --format=%aI -- .")).toBe(false);
    expect(
      inArchive.some((c) => c.args.join(" ").startsWith("log --follow --format=%aI -- 1-description.md")),
    ).toBe(true);
  });

  // The roots are asked together. The sequential `for`
  // loop this replaces was the spec list's largest single cost — one
  // TCP/TLS round trip to GitHub per root, one after another.
  test("every root's ls-remote goes out concurrently, not one after another", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    const git = recordingGit({
      hold: async (args) => {
        if (args[0] === "ls-remote") await gate;
      },
    });
    harness.start({
      extra: {
        gitRun: git.run,
        driftPollMs: 0,
        specCachePollMs: 25,
        queueProjects: ["aide", "atlasaurus"],
      },
      alsoProjects: ["atlasaurus"],
      archivedSpecs: { "77-old-thing": {}, "78-other": { project: "atlasaurus" } },
    });
    // Both roots' calls are in the air at the same moment — which they
    // cannot be if each `await`s the one before it.
    const both = await until(() => lsRemotes(git.calls).length >= 2, 2000);
    release();
    expect(both).toBe(true);
    expect(git.peak()).toBeGreaterThan(1);
  });

  test("a tick that has not finished is not joined by the next one", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    const git = recordingGit({ hold: async () => await gate });
    harness.start({
      extra: { gitRun: git.run, driftPollMs: 0, specCachePollMs: 15 },
      archivedSpecs: { "77-old-thing": {} },
    });
    await until(() => warmerCalls(git.calls).length > 0);
    const afterFirstTick = warmerCalls(git.calls).length;
    // Several intervals' worth of firings, every one of them into a
    // tick that is still going.
    await new Promise((r) => setTimeout(r, 120));
    expect(warmerCalls(git.calls).length).toBe(afterFirstTick);
    release();
  });

  // Asked of the behaviour rather than of `clearInterval`:
  // `bun test` runs many suites in one process, and a timer from a
  // stopped server would go on firing into the next one.
  test("stop() ends the schedule", async () => {
    const git = recordingGit();
    const { server } = harness.start({
      extra: { gitRun: git.run, driftPollMs: 0, specCachePollMs: 15 },
    });
    // Settled, not merely started: `stop()` clears the interval, and a
    // tick already in flight still finishes the awaits it is holding.
    // What is under test is that no FURTHER tick fires.
    await until(() => warmerCalls(git.calls).length > 0);
    await settled(() => warmerCalls(git.calls).length);
    server.stop();
    const afterStop = warmerCalls(git.calls).length;
    await new Promise((r) => setTimeout(r, 100));
    expect(warmerCalls(git.calls).length).toBe(afterStop);
  });

  // The set is read off a peek now, and an unwarmed root
  // contributes NOTHING — which is what keeps `resolveProject` failing
  // closed, exactly as an empty `unlanded` set does today.
  test("archive cannot be re-enqueued for an archived spec whose roots are unwarmed", async () => {
    const git = recordingGit();
    const { base } = harness.start({
      // The schedule off entirely: nothing has ever been asked, which
      // is the state this criterion is about.
      extra: { gitRun: git.run, driftPollMs: 0, specCachePollMs: 0 },
      archivedSpecs: { "77-old-thing": {} },
    });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "77-old-thing", steps: ["archive"] }),
    });
    // Refused by name — the archived spec is not a folder any step but
    // `reopen` may be asked for while nothing says its branch is open.
    expect((await res.text()).toLowerCase()).toContain("archived");
    expect(lsRemotes(git.calls).length).toBe(0);
  });

  // `landBranch()` invalidates the disk-scan
  // cache the instant a merge lands (`scan = null`), but nothing did the
  // same for `workflowHistory` — the schedule above was the only thing
});

// `refreshSpecCaches` is the only other writer of `openCache`
// besides a landing's own fresh recheck, and until now it corrected a
// stale answer without telling anyone — an already-open tab stayed
// wrong until an unrelated queue event or a reload happened to ask
// again.
//
// These three call `refreshSpecCaches` directly against a hand-built
// `ScheduleContext`, twice in a row, rather than through the full HTTP
// harness: `BranchStatusChecker`'s own `openSpecBranches` cache has a
// FIXED 30-second TTL (`setup/project-resolution.ts` never overrides
// it, and no `ServerOptions` field reaches it either), entirely
// independent of `specCachePollMs` — so two ticks fired via the real
// schedule, milliseconds apart in test time, would have the SECOND one
// answer straight out of cache without asking git again at all. A
// `BranchStatusChecker` built here with `ttlMs: 0` has no such window:
// every call is real, letting two sequential `await refreshSpecCaches`
// calls stand in for two genuinely distinct ticks. `targets: () => []`
// (no live spec) and an empty `dirs` map (no archive-date lookup owed)
// keep every OTHER checker this function can reach unused, so the
// context below only has to answer what `refreshSpecCaches` actually
// asks of it for this scenario.
describe("refreshSpecCaches tells an open tab when its answer changes", () => {
  /** One archived spec, one root, and a `branchOpen` flag the test
   *  flips between calls — the fake's only job is to report it. */
  function singleRootCtx() {
    const branchOpen = { value: true };
    const calls: GitCall[] = [];
    const run: GitRunner = async (dir, args) => {
      calls.push({ dir, args });
      if (args[0] === "ls-remote") {
        return {
          code: 0,
          stdout: branchOpen.value ? "sha\trefs/heads/aide/77-old-thing\n" : "",
        };
      }
      return { code: 1, stdout: "" };
    };
    let warming = false;
    let notifyCount = 0;
    const ctx: ScheduleContext = {
      projectRoot: undefined,
      machineryProjectDir: (p) => `/fake/${p}`,
      scheduleStore: createScheduleStore(undefined),
      branchStatus: new BranchStatusChecker({ run, ttlMs: 0 }),
      readWorkflowHistory: () => ({}) as unknown as WorkflowHistoryChecker,
      readFreshness: () => ({}) as unknown as DescriptionFreshnessChecker,
      readSpecCreatedAt: () => ({}) as unknown as SpecCreatedAtChecker,
      readSpecFileCommits: () => ({}) as unknown as SpecFileCommitChecker,
      specsRoot: async (dir) => dir,
      readBranchFileSteps: () => ({}) as unknown as BranchFileStepsChecker,
      targets: () => [],
      readScan: () => ({ archived: ["aide/77-old-thing"], dirs: new Map() }),
      invalidateScan: () => {},
      allowed: new Set(),
      ensureCheckout: async () => undefined,
      getWarming: () => warming,
      setWarming: (v) => {
        warming = v;
      },
      queue: {} as unknown as QueueStore,
      specRoots: () => ["/fake/root/aide"],
      readRunner: () => null,
      checkoutEnsurer: {} as unknown as CheckoutEnsurer,
      notifyQueueChanged: () => {
        notifyCount += 1;
      },
    };
    return { ctx, branchOpen, calls, notifyCount: () => notifyCount };
  }

  // Single root.
  test("a root's ls-remote answer changing between two ticks fires exactly one `changed` event", async () => {
    const { ctx, branchOpen, notifyCount } = singleRootCtx();
    // tick 0: discovers the branch open. Its null-to-known transition is
    // a change too — and not what this test is about.
    await refreshSpecCaches(ctx);
    expect(notifyCount()).toBe(1);
    // tick 1: the branch is gone now.
    branchOpen.value = false;
    await refreshSpecCaches(ctx);
    expect(notifyCount()).toBe(2);
  });

  test("a tick whose answer has not moved stays silent", async () => {
    const { ctx, notifyCount } = singleRootCtx();
    await refreshSpecCaches(ctx); // tick 0: discovery
    expect(notifyCount()).toBe(1);
    await refreshSpecCaches(ctx); // tick 1: same answer as tick 0
    // Still 1 — the second tick found nothing new, exactly as
    // every other reason a page might redraw.
    expect(notifyCount()).toBe(1);
  });

  // Multi-root: "exactly once — not once per root".
  test("several roots flipping in the same tick still fire exactly one `changed` event", async () => {
    const branchOpen = { value: true };
    const calls: GitCall[] = [];
    const run: GitRunner = async (dir, args) => {
      calls.push({ dir, args });
      if (args[0] === "ls-remote") {
        return {
          code: 0,
          stdout: branchOpen.value ? "sha\trefs/heads/aide/77-old-thing\n" : "",
        };
      }
      return { code: 1, stdout: "" };
    };
    let warming = false;
    let notifyCount = 0;
    const ctx: ScheduleContext = {
      projectRoot: undefined,
      machineryProjectDir: (p) => `/fake/${p}`,
      scheduleStore: createScheduleStore(undefined),
      branchStatus: new BranchStatusChecker({ run, ttlMs: 0 }),
      readWorkflowHistory: () => ({}) as unknown as WorkflowHistoryChecker,
      readFreshness: () => ({}) as unknown as DescriptionFreshnessChecker,
      readSpecCreatedAt: () => ({}) as unknown as SpecCreatedAtChecker,
      readSpecFileCommits: () => ({}) as unknown as SpecFileCommitChecker,
      specsRoot: async (dir) => dir,
      readBranchFileSteps: () => ({}) as unknown as BranchFileStepsChecker,
      targets: () => [],
      // Two projects, two roots, both watched by the same tick.
      readScan: () => ({ archived: ["aide/77-old-thing", "atlasaurus/78-other"], dirs: new Map() }),
      invalidateScan: () => {},
      allowed: new Set(),
      ensureCheckout: async () => undefined,
      getWarming: () => warming,
      setWarming: (v) => {
        warming = v;
      },
      queue: {} as unknown as QueueStore,
      specRoots: (project) => [`/fake/root/${project}`],
      readRunner: () => null,
      checkoutEnsurer: {} as unknown as CheckoutEnsurer,
      notifyQueueChanged: () => {
        notifyCount += 1;
      },
    };
    await refreshSpecCaches(ctx); // tick 0: both roots discover the branch open
    expect(notifyCount).toBe(1);
    branchOpen.value = false; // both roots flip together
    await refreshSpecCaches(ctx); // tick 1
    // One tick, one event, however many roots moved inside it — not
    // one per root.
    expect(notifyCount).toBe(2);
    expect(calls.filter((c) => c.args[0] === "ls-remote")).toHaveLength(4);
  });
});

// The specs list offers a test server only for a branch origin holds in the
// project's code checkout, read from the cached set these two calls fill.
describe("the code checkout's branches are asked for a live spec", () => {
  const CODE = "/fake/code/aide";
  const SPECS = "/fake/specs/aide";
  const FOLDER = "562-live";

  /** One live spec with no `dir` (so `warmSpec` reads nothing), no archived
   *  spec, and a code checkout apart from the specs root. `originHas` is
   *  what `ls-remote` reports. */
  function liveCtx() {
    const originHas = { value: false };
    const calls: GitCall[] = [];
    const run: GitRunner = async (dir, args) => {
      calls.push({ dir, args });
      if (args[0] === "ls-remote") {
        return { code: 0, stdout: originHas.value ? `sha\trefs/heads/aide/${FOLDER}\n` : "" };
      }
      return { code: 1, stdout: "" };
    };
    let warming = false;
    const ctx: ScheduleContext = {
      projectRoot: undefined,
      machineryProjectDir: () => CODE,
      scheduleStore: createScheduleStore(undefined),
      branchStatus: new BranchStatusChecker({ run, ttlMs: 0 }),
      readWorkflowHistory: () => ({}) as unknown as WorkflowHistoryChecker,
      readFreshness: () => ({}) as unknown as DescriptionFreshnessChecker,
      readSpecCreatedAt: () => ({}) as unknown as SpecCreatedAtChecker,
      readSpecFileCommits: () => ({}) as unknown as SpecFileCommitChecker,
      specsRoot: async (dir) => dir,
      readBranchFileSteps: () => ({}) as unknown as BranchFileStepsChecker,
      targets: () => [{ project: "aide", specFolder: FOLDER }],
      readScan: () => ({ archived: [], dirs: new Map() }),
      invalidateScan: () => {},
      allowed: new Set(),
      ensureCheckout: async () => undefined,
      getWarming: () => warming,
      setWarming: (v) => {
        warming = v;
      },
      queue: {} as unknown as QueueStore,
      specRoots: () => [CODE, SPECS],
      readRunner: () => null,
      checkoutEnsurer: {} as unknown as CheckoutEnsurer,
      notifyQueueChanged: () => {},
    };
    return { ctx, originHas, calls };
  }

  test("a project with a live spec and no archived spec has its code checkout asked", async () => {
    const { ctx, originHas, calls } = liveCtx();
    originHas.value = true;
    await refreshSpecCaches(ctx);
    expect(lsRemotes(calls).map((c) => c.dir)).toContain(CODE);
    expect(ctx.branchStatus.peekOpenSpecBranches(CODE).open?.has(`aide/${FOLDER}`)).toBe(true);
  });

  test("a step's end asks origin again, so a branch implement just pushed is there at once", async () => {
    const { ctx, originHas } = liveCtx();
    await refreshSpecCaches(ctx); // the sweep found origin without the branch
    originHas.value = true;
    await rereadSpec(ctx, "", FOLDER, { askOrigin: true });
    expect(ctx.branchStatus.peekOpenSpecBranches(CODE).open?.has(`aide/${FOLDER}`)).toBe(true);
  });

  test("a re-read without the option asks origin nothing", async () => {
    const { ctx, calls } = liveCtx();
    await rereadSpec(ctx, "", FOLDER);
    expect(lsRemotes(calls)).toHaveLength(0);
  });
});

// An archived spec whose branch is still on origin may have merged: a
// landing whose delete failed. The row peeks git's merged answer, and
// this sweep is what keeps that answer warm — for the few archived specs
// whose branch is open, never for the rest of the archive.
describe("refreshSpecCaches asks whether an open archived branch is merged", () => {
  const ROOT = "/fake/root/aide";
  const OPEN = "aide/77-old-thing";

  function mergedCtx() {
    const ancestor = { code: 0 };
    const calls: GitCall[] = [];
    const run: GitRunner = async (dir, args) => {
      calls.push({ dir, args });
      if (args[0] === "ls-remote") return { code: 0, stdout: `sha\trefs/heads/${OPEN}\n` };
      if (args[0] === "symbolic-ref") return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (args[0] === "merge-base") return { code: ancestor.code, stdout: "" };
      if (args[0] === "fetch") return { code: 0, stdout: "" };
      return { code: 1, stdout: "" };
    };
    let warming = false;
    let notifyCount = 0;
    const branchStatus = new BranchStatusChecker({ run, ttlMs: 0 });
    const ctx: ScheduleContext = {
      projectRoot: undefined,
      machineryProjectDir: (p) => `/fake/${p}`,
      scheduleStore: createScheduleStore(undefined),
      branchStatus,
      readWorkflowHistory: () => ({}) as unknown as WorkflowHistoryChecker,
      readFreshness: () => ({}) as unknown as DescriptionFreshnessChecker,
      readSpecCreatedAt: () => ({}) as unknown as SpecCreatedAtChecker,
      readSpecFileCommits: () => ({}) as unknown as SpecFileCommitChecker,
      specsRoot: async (dir) => dir,
      readBranchFileSteps: () => ({}) as unknown as BranchFileStepsChecker,
      targets: () => [],
      // The second branch is gone from origin: nothing about it is asked.
      readScan: () => ({ archived: ["aide/77-old-thing", "aide/78-gone"], dirs: new Map() }),
      invalidateScan: () => {},
      allowed: new Set(),
      ensureCheckout: async () => undefined,
      getWarming: () => warming,
      setWarming: (v) => {
        warming = v;
      },
      queue: {} as unknown as QueueStore,
      specRoots: () => [ROOT],
      readRunner: () => null,
      checkoutEnsurer: {} as unknown as CheckoutEnsurer,
      notifyQueueChanged: () => {
        notifyCount += 1;
      },
    };
    return { ctx, ancestor, calls, branchStatus, notifyCount: () => notifyCount };
  }

  test("for an archived spec whose branch is open, and not for one whose branch is gone", async () => {
    const { ctx, calls, branchStatus } = mergedCtx();
    expect(branchStatus.peekMerged(ROOT, OPEN)).toBeNull();
    await refreshSpecCaches(ctx);
    const asked = calls.filter((c) => c.args[0] === "merge-base").map((c) => c.args[2]);
    expect(asked).toEqual([`refs/remotes/origin/${OPEN}`]);
    expect(branchStatus.peekMerged(ROOT, OPEN)).toBe(true);
    expect(branchStatus.peekMerged(ROOT, "aide/78-gone")).toBeNull();
  });

  test("a merged answer that flips sends exactly one change event", async () => {
    const { ctx, ancestor, notifyCount } = mergedCtx();
    await refreshSpecCaches(ctx); // discovery: the open set moved
    expect(notifyCount()).toBe(1);
    await refreshSpecCaches(ctx); // nothing moved
    expect(notifyCount()).toBe(1);
    ancestor.code = 1; // the open set is the same; only the merged answer moved
    await refreshSpecCaches(ctx);
    expect(notifyCount()).toBe(2);
  });
});

// A project that reviews its code leaves the archived spec's branch on
// origin until the pull request is dealt with. Only GitHub knows whether
// that request merged, so the sweep asks `gh` for those branches — and for
// no others — and keeps what it was told for the row and the press to read.
describe("refreshSpecCaches asks GitHub whether an archived spec's pull request merged", () => {
  const CODE = "/fake/aide";
  const OPEN = "aide/77-old-thing";
  // `project/folder`, which here reads the same as the branch name.
  const OPEN_KEY = "aide/77-old-thing";
  const GONE_KEY = "aide/78-gone";
  const MERGED_REQUEST = JSON.stringify([{ state: "MERGED", headRefOid: "abc123" }]);

  function sweepCtx(landing: "pr" | "merge") {
    const run: GitRunner = async (_dir, args) => {
      if (args[0] === "ls-remote") return { code: 0, stdout: `sha\trefs/heads/${OPEN}\n` };
      if (args[0] === "symbolic-ref") return { code: 0, stdout: "refs/remotes/origin/main\n" };
      if (args[0] === "merge-base") return { code: 1, stdout: "" };
      return { code: 0, stdout: "" };
    };
    const gh = { code: 0, stdout: MERGED_REQUEST };
    const asked: { dir: string; args: string[] }[] = [];
    const ghRun: GhRunner = async (dir, args) => {
      asked.push({ dir, args });
      return { code: gh.code, stdout: gh.stdout };
    };
    const pullRequests = new Map<string, PullRequestAnswer>();
    let warming = false;
    let notifyCount = 0;
    const ctx: ScheduleContext = {
      projectRoot: undefined,
      machineryProjectDir: () => CODE,
      scheduleStore: createScheduleStore(undefined),
      branchStatus: new BranchStatusChecker({ run, ttlMs: 0 }),
      readWorkflowHistory: () => ({}) as unknown as WorkflowHistoryChecker,
      readFreshness: () => ({}) as unknown as DescriptionFreshnessChecker,
      readSpecCreatedAt: () => ({}) as unknown as SpecCreatedAtChecker,
      readSpecFileCommits: () => ({}) as unknown as SpecFileCommitChecker,
      specsRoot: async (dir) => dir,
      readBranchFileSteps: () => ({}) as unknown as BranchFileStepsChecker,
      targets: () => [],
      readScan: () => ({ archived: [OPEN_KEY, GONE_KEY], dirs: new Map() }),
      invalidateScan: () => {},
      allowed: new Set(),
      ensureCheckout: async () => undefined,
      getWarming: () => warming,
      setWarming: (v) => {
        warming = v;
      },
      queue: {} as unknown as QueueStore,
      specRoots: () => [CODE],
      readRunner: () => null,
      checkoutEnsurer: {} as unknown as CheckoutEnsurer,
      notifyQueueChanged: () => {
        notifyCount += 1;
      },
      codeLanding: () => landing,
      ghRun,
      pullRequests,
    };
    return { ctx, gh, asked, pullRequests, notifyCount: () => notifyCount };
  }

  test("for a pr project's archived spec whose branch is on origin, and for no other", async () => {
    const { ctx, asked, pullRequests } = sweepCtx("pr");
    await refreshSpecCaches(ctx);
    expect(asked.map((a) => a.args.slice(0, 4))).toEqual([["pr", "list", "--head", OPEN]]);
    expect(asked[0]?.dir).toBe(CODE);
    expect(pullRequests.get(OPEN_KEY)).toEqual({ merged: true, headSha: "abc123" });
    expect(pullRequests.has(GONE_KEY)).toBe(false);
  });

  test("an answer that moves sends one change event, one that stays does not", async () => {
    const { ctx, gh, notifyCount } = sweepCtx("pr");
    await refreshSpecCaches(ctx); // discovery: the open set and the answer moved
    expect(notifyCount()).toBe(1);
    await refreshSpecCaches(ctx);
    expect(notifyCount()).toBe(1);
    gh.stdout = JSON.stringify([{ state: "OPEN", headRefOid: "abc123" }]);
    await refreshSpecCaches(ctx);
    expect(notifyCount()).toBe(2);
  });

  test("a project that merges its code at archive never runs gh", async () => {
    const { ctx, asked, pullRequests } = sweepCtx("merge");
    await refreshSpecCaches(ctx);
    expect(asked).toEqual([]);
    expect(pullRequests.size).toBe(0);
  });

  test("a gh that fails leaves the last answer where it was", async () => {
    const { ctx, gh, pullRequests } = sweepCtx("pr");
    await refreshSpecCaches(ctx);
    gh.code = 1;
    gh.stdout = "";
    await refreshSpecCaches(ctx);
    expect(pullRequests.get(OPEN_KEY)).toEqual({ merged: true, headSha: "abc123" });
    gh.code = 0;
    gh.stdout = "oops";
    await refreshSpecCaches(ctx);
    expect(pullRequests.get(OPEN_KEY)).toEqual({ merged: true, headSha: "abc123" });
  });

  test("an answer about a branch origin no longer holds, or a spec no longer archived, is dropped", async () => {
    const { ctx, pullRequests } = sweepCtx("pr");
    pullRequests.set(GONE_KEY, { merged: true, headSha: "old" });
    pullRequests.set("aide/99-not-archived", { merged: true, headSha: "old" });
    await refreshSpecCaches(ctx);
    expect([...pullRequests.keys()]).toEqual([OPEN_KEY]);
  });
});

// Until a sweep has read every spec since the board started, nothing says what a
// spec has done: the board's group Start, its moves to a next member and the Jobs
// list all wait on this mark.
describe("the first sweep that read every listed spec sets the board's mark", () => {
  /** A context whose live specs `list()` names, each with a directory, and whose
   *  checkers answer nothing. `events` records each checkout asked and each list taken. */
  function markCtx(
    list: () => { project: string; specFolder: string; dir: string }[],
    historySucceeded = true,
  ) {
    const events: string[] = [];
    let warming = false;
    let notified = 0;
    const mark = firstSweepMark(() => { notified += 1; });
    const none = async () => null;
    const ctx: ScheduleContext = {
      projectRoot: undefined,
      machineryProjectDir: (p) => `/fake/${p}`,
      scheduleStore: createScheduleStore(undefined),
      branchStatus: new BranchStatusChecker({ run: async () => ({ code: 1, stdout: "" }), ttlMs: 0 }),
      readWorkflowHistory: () => ({ read: none, readSucceeded: () => historySucceeded }) as unknown as WorkflowHistoryChecker,
      readFreshness: () => ({ isStale: none }) as unknown as DescriptionFreshnessChecker,
      readSpecCreatedAt: () => ({ createdAt: none }) as unknown as SpecCreatedAtChecker,
      readSpecFileCommits: () => ({ commitFor: none }) as unknown as SpecFileCommitChecker,
      specsRoot: async (dir) => dir,
      readBranchFileSteps: () => ({ read: none }) as unknown as BranchFileStepsChecker,
      targets: () => { events.push("list"); return list(); },
      readScan: () => ({ archived: [], dirs: new Map() }),
      invalidateScan: () => {},
      allowed: new Set(["aide"]),
      ensureCheckout: async () => { events.push("checkout"); return undefined; },
      getWarming: () => warming,
      setWarming: (v) => { warming = v; },
      queue: {} as unknown as QueueStore,
      specRoots: () => [],
      readRunner: () => null,
      checkoutEnsurer: {} as unknown as CheckoutEnsurer,
      notifyQueueChanged: () => {},
      specsScanned: mark.scanned,
      markSpecsScanned: mark.mark,
    };
    return { ctx, mark, events, notified: () => notified };
  }
  const spec = (folder: string) => ({ project: "aide", specFolder: folder, dir: `/fake/specs/${folder}` });

  test("a sweep that read every listed spec sets the mark, and open pages are told once (AC-1, AC-2, AC-4)", async () => {
    const { ctx, mark, notified } = markCtx(() => [spec("81-one"), spec("82-two")]);
    expect(mark.scanned()).toBe(false);
    await refreshSpecCaches(ctx);
    expect(mark.scanned()).toBe(true);
    expect(notified()).toBe(1);
    await refreshSpecCaches(ctx);
    expect(notified()).toBe(1);
  });

  test("a sweep after which the list names a spec it did not read leaves the mark unset (AC-1, AC-2, AC-4)", async () => {
    let lists = 0;
    const { ctx, mark } = markCtx(() => (lists++ === 0 ? [spec("81-one")] : [spec("81-one"), spec("83-created-meanwhile")]));
    await refreshSpecCaches(ctx);
    expect(mark.scanned()).toBe(false);
  });

  test("a failed history answer leaves the mark unset (AC-1, AC-2, AC-4)", async () => {
    const { ctx, mark } = markCtx(() => [spec("81-one")], false);
    await refreshSpecCaches(ctx);
    expect(mark.scanned()).toBe(false);
  });

  test("with no mark, the checkouts are asked before the list is taken; with it, the sweep is as before (AC-1, AC-5)", async () => {
    const { ctx, events } = markCtx(() => [spec("81-one")]);
    await refreshSpecCaches(ctx);
    expect(events[0]).toBe("checkout");
    events.length = 0;
    await refreshSpecCaches(ctx);
    expect(events[0]).toBe("list");
  });

  test("what waits for the mark runs once it is set, and at once after it (AC-2)", () => {
    const mark = firstSweepMark(() => {});
    const ran: string[] = [];
    mark.whenScanned(() => { throw new Error("one waiter fails"); });
    mark.whenScanned(() => ran.push("waited"));
    expect(ran).toEqual([]);
    mark.mark();
    expect(ran).toEqual(["waited"]);
    mark.whenScanned(() => ran.push("at once"));
    expect(ran).toEqual(["waited", "at once"]);
  });
});
