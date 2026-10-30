// `rereadProject`: after a fetch brought in what another machine pushed,
// every live spec of ONE project is read again at once and the open tabs
// are told once. The checkers answer from a cache while an answer is
// younger than its window, so the re-read marks them due first; a
// recording git runner shows which specs git was asked about again.

import { describe, expect, test } from "bun:test";
import { BranchStatusChecker } from "../../src/git/branch-status.ts";
import type { GitRunner } from "../../src/git/branch-status.ts";
import { BranchFileStepsChecker } from "../../src/git/branch-file-steps.ts";
import {
  DescriptionFreshnessChecker, SpecCreatedAtChecker, SpecFileCommitChecker,
} from "../../src/git/description-freshness.ts";
import { WorkflowHistoryChecker } from "../../src/git/workflow-history.ts";
import type { CheckoutEnsurer } from "../../src/git/checkout-ensurer.ts";
import type { QueueStore } from "../../src/queue/queue.ts";
import { createScheduleStore } from "../../src/queue/schedule-store.ts";
import { rereadProject, warmSpec, type ScheduleContext } from "../../src/serve/schedules";
import type { GitCall } from "../helpers/fake-git.ts";

const WINDOW_MS = 60 * 60_000;

const specs = [
  { project: "aide", specFolder: "10-first", dir: "/specs/aide/10-first" },
  { project: "aide", specFolder: "11-second", dir: "/specs/aide/11-second" },
  { project: "other", specFolder: "20-elsewhere", dir: "/specs/other/20-elsewhere" },
];

function context() {
  const calls: GitCall[] = [];
  const run: GitRunner = async (dir, args) => {
    calls.push({ dir, args });
    if (args[0] === "log") return { code: 0, stdout: "deadbee\t2026-08-18T09:10:36+02:00\n" };
    return { code: 1, stdout: "" };
  };
  const history = new WorkflowHistoryChecker({ run, ttlMs: WINDOW_MS });
  const freshness = new DescriptionFreshnessChecker({ run, ttlMs: WINDOW_MS });
  const created = new SpecCreatedAtChecker({ run, ttlMs: WINDOW_MS });
  const fileCommits = new SpecFileCommitChecker({ run, ttlMs: WINDOW_MS });
  const branchFiles = new BranchFileStepsChecker({ run, ttlMs: WINDOW_MS });
  let told = 0;
  let warming = false;
  const ctx: ScheduleContext = {
    projectRoot: undefined,
    machineryProjectDir: (p) => `/code/${p}`,
    scheduleStore: createScheduleStore(undefined),
    branchStatus: new BranchStatusChecker({ run, ttlMs: 0 }),
    readWorkflowHistory: () => history,
    readFreshness: () => freshness,
    readSpecCreatedAt: () => created,
    readSpecFileCommits: () => fileCommits,
    specsRoot: async (dir) => dir,
    readBranchFileSteps: () => branchFiles,
    targets: () => specs,
    readScan: () => ({ archived: [], dirs: new Map() }),
    allowed: new Set(),
    ensureCheckout: async () => undefined,
    getWarming: () => warming,
    setWarming: (v) => {
      warming = v;
    },
    queue: {} as unknown as QueueStore,
    specRoots: () => [],
    readRunner: () => null,
    checkoutEnsurer: {} as unknown as CheckoutEnsurer,
    notifyQueueChanged: () => {
      told += 1;
    },
  };
  return { ctx, calls, told: () => told };
}

/** The history and freshness questions git was asked about one spec: the
 *  two the row's steps and its "plan is out of date" mark are drawn from. */
const askedAbout = (calls: GitCall[], dir: string) =>
  calls.filter((c) => c.dir === dir && c.args[0] === "log" && (c.args[1] === "--all" || c.args[1] === "-1")).length;

describe("rereadProject", () => {
  test("asks git again about every live spec of the project, and about no other project's, even inside the window (AC-2)", async () => {
    const { ctx, calls } = context();
    for (const t of specs) await warmSpec(ctx, t);
    const before = new Map(specs.map((t) => [t.dir, askedAbout(calls, t.dir)]));
    expect(before.get("/specs/aide/10-first")).toBeGreaterThan(0);

    await rereadProject(ctx, "aide");

    expect(askedAbout(calls, "/specs/aide/10-first")).toBeGreaterThan(before.get("/specs/aide/10-first")!);
    expect(askedAbout(calls, "/specs/aide/11-second")).toBeGreaterThan(before.get("/specs/aide/11-second")!);
    expect(askedAbout(calls, "/specs/other/20-elsewhere")).toBe(before.get("/specs/other/20-elsewhere")!);
  });

  test("tells the open tabs exactly once, however many specs it read (AC-2)", async () => {
    const { ctx, told } = context();
    await rereadProject(ctx, "aide");
    expect(told()).toBe(1);
  });
});
