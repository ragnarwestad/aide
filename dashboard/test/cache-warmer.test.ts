// Spec 208: nothing slow happens while a page is being drawn.
//
// Three fixes had been made for this, one page each — spec 178 (never
// merged), spec 203 (/projects, shipped), and then spec 193 put a
// network `ls-remote` straight back onto the spec list's render path
// the next day. The pattern spec 203 established is applied to the
// whole app here: every checker gains a synchronous `peek*`, and ONE
// background schedule keeps them all fed.
//
// This suite is about that schedule — what it asks, of whom, how often
// and how concurrently. The peeks themselves are tested next to the
// checkers that own them; what the pages do with the answers is tested
// in `queue-routes.test.ts`.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueHarness } from "./helpers/queue-server.ts";
import type { GitCall } from "./helpers/fake-git.ts";
import type { GitRunner } from "../src/branch-status.ts";

const harness = queueHarness("aide-cache-warmer-");

afterEach(() => harness.cleanup());

const TOKEN = "s3cret-token";
const AUTH = { "x-aide-token": TOKEN };

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
  // Criterion 3.
  test("one tick fills every checker for the live spec and the archived spec's root", async () => {
    const git = recordingGit();
    harness.start({
      extra: { gitRun: git.run, queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 25 },
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
    // And, for the archived spec, the network question spec 193 added.
    expect(await until(() => lsRemotes(git.calls).length > 0)).toBe(true);
  });

  // Criterion 4.
  test("no archived spec is warmed as if it were live", async () => {
    const git = recordingGit();
    harness.start({
      extra: { gitRun: git.run, queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 25 },
      archivedSpecs: { "77-old-thing": {} },
    });
    await until(() => lsRemotes(git.calls).length > 0);
    await new Promise((r) => setTimeout(r, 80));
    // The per-spec sweep walks `targets()`, which is the LIVE list. An
    // archived spec is asked ONE question — the date it was archived,
    // and only where its `4-status.md` carries no stamp — and none of
    // the four the live sweep asks. Warming every spec that ever
    // existed, forever, is the cost spec 178's own plan review
    // rejected.
    const inArchive = git.calls.filter((c) => c.dir.includes("archive"));
    expect(inArchive.some((c) => c.args.join(" ").startsWith("log --all"))).toBe(false);
    expect(inArchive.some((c) => c.args.join(" ").includes("-- 1-description.md"))).toBe(false);
    expect(inArchive.some((c) => c.args.join(" ").startsWith("log --format=%aI"))).toBe(false);
  });

  // Criterion 7: the roots are asked together. The sequential `for`
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
        queueToken: TOKEN,
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

  // Criterion 15.
  test("a tick that has not finished is not joined by the next one", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    const git = recordingGit({ hold: async () => await gate });
    harness.start({
      extra: { gitRun: git.run, queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 15 },
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

  // Criterion 11. Asked of the behaviour rather than of `clearInterval`:
  // `bun test` runs many suites in one process, and a timer from a
  // stopped server would go on firing into the next one.
  test("stop() ends the schedule", async () => {
    const git = recordingGit();
    const { server } = harness.start({
      extra: { gitRun: git.run, queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 15 },
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

  // Criterion 16. The set is read off a peek now, and an unwarmed root
  // contributes NOTHING — which is what keeps `resolveProject` failing
  // closed, exactly as an empty `unlanded` set does today.
  test("archive cannot be re-enqueued for an archived spec whose roots are unwarmed", async () => {
    const git = recordingGit();
    const { base } = harness.start({
      // The schedule off entirely: nothing has ever been asked, which
      // is the state this criterion is about.
      extra: { gitRun: git.run, queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 0 },
      archivedSpecs: { "77-old-thing": {} },
    });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "77-old-thing", steps: ["archive"] }),
    });
    // Refused by name — the archived spec is not a folder any step but
    // `reopen` may be asked for while nothing says its branch is open.
    expect((await res.text()).toLowerCase()).toContain("archived");
    expect(lsRemotes(git.calls).length).toBe(0);
  });

  // Spec 254, criterion 3: `landBranch()` invalidates the disk-scan
  // cache the instant a merge lands (`scan = null`), but nothing did the
  // same for `workflowHistory` — the schedule above was the only thing
  // that ever warmed it. A CREATE landing, deliberately: its folder does
  // not exist until the merge lands, so — unlike an existing live spec —
  // the boot-time sweep above can never have warmed it already, and a
  // `log --all` call for it can only have come from the landing itself.
  // `specCachePollMs` is set far past this test's own patience, so the
  // schedule cannot be the source either.
  test("a create landing warms its own (never-before-warmed) spec immediately (criterion 3)", async () => {
    const jobs = mkdtempSync(join(tmpdir(), "aide-254-jobs-"));
    try {
      const git = recordingGit();
      // `recordingGit` only answers the warmer's own questions
      // (ls-remote, log); every call is routed through it first so it
      // still RECORDS the landing's plumbing commands, then the ones a
      // real merge needs are overridden with a plain success.
      const landingGit: GitRunner = async (dir, args) => {
        const recorded = await git.run(dir, args);
        const a = args.join(" ");
        if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
        if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
        if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
        if (a.startsWith("switch")) return { code: 0, stdout: "" };
        if (a.startsWith("fetch")) return { code: 0, stdout: "" };
        if (a.startsWith("pull")) return { code: 0, stdout: "" };
        if (a.startsWith("remote get-url")) return { code: 0, stdout: "https://example.test/aide\n" };
        if (a.startsWith("push")) return { code: 0, stdout: "" };
        if (a.startsWith("branch -d")) return { code: 0, stdout: "" };
        if (a.startsWith("merge -q --ff-only") || a.startsWith("merge -q --no-edit")) return { code: 0, stdout: "" };
        if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
        return recorded;
      };
      const { base, dir } = harness.start({
        extra: {
          gitRun: landingGit,
          queueToken: TOKEN,
          driftPollMs: 0,
          specCachePollMs: 60_000,
          queueRunnerBin: "/usr/bin/true",
          queueResultDir: jobs,
        },
      });
      const made = (await (
        await fetch(`${base}/api/queue/create`, {
          method: "POST",
          headers: { ...AUTH, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ project: "aide", title: "A new spec", description: "Do the thing" }),
        })
      ).json()) as { job: { id: string } };
      // The merge really does put the folder on disk, which is the
      // whole reason the landing step exists (mirrors
      // "a landed spec is an ordinary row" in queue-routes.test.ts).
      const specDir = join(dir, "root", "aide", "specs", "94-a-new-spec");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "1-description.md"), "# A new spec - Description\n");
      writeFileSync(
        join(specDir, "4-status.md"),
        "# Status\n\n## Tracking info\n\n- **Workflow steps completed:** create\n",
      );
      writeFileSync(
        join(jobs, `${made.job.id}.json`),
        JSON.stringify({
          ok: true,
          exitCode: 0,
          costUsd: 0.4,
          costMeasured: true,
          terminalReason: "completed",
          branch: "aide/new-abc123de",
          specFolder: "94-a-new-spec",
          branchUrls: [{ root: join(dir, "root", "aide"), url: "https://example.test/aide" }],
          repos: [],
        }),
      );
      const logAllForSpec = () =>
        git.calls.filter((c) => c.args.join(" ").startsWith("log --all") && c.dir.includes("94-a-new-spec")).length;
      const warmed = await until(() => logAllForSpec() > 0, 5000);
      expect(warmed).toBe(true);
    } finally {
      rmSync(jobs, { recursive: true, force: true });
    }
  }, 10000);
});
