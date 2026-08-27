import { describe, expect, test } from "bun:test";
import {
  PHASE_STEPS,
  currentWorkRoundJobs,
  parseJobRequest,
  type QueueDefaults,
} from "../../src/queue/queue.ts";

const DEFAULTS: QueueDefaults = {
  budgetUsd: 3,
  jobCapUsd: 10,
  dailyCapUsd: 20,
  // Per step since spec 152: an implement is not an analyze, and one
  // number for both stopped 149 mid-sentence with its tests green.
  timeoutSec: { default: 1200, implement: 5400 },
  permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
  model: { implement: "opus", default: "sonnet" },
};

// The server resolves a project NAME to its real spec folders; the
// request never carries a path. Two allowlisted projects here.
const resolve = (project: string) =>
  project === "aide"
    ? { specFolders: ["81-queue-and-runner"] }
    : project === "aide-dashboard"
      ? { specFolders: ["01-first"] }
      : null;

const REQ = { project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] };

// --- spec 198: reopening is a step like any other ---------------------------
//
// The dashboard's Reopen control and `/aide-reopen` in a terminal are
// one operation, and the way to keep them one is to give them one path:
// both enqueue `reopen`, which drives `aide-run-spec --command reopen`
// exactly as `archive` and `analyze` already do. Nothing about the
// enqueue is special-cased for it — which is what the test below is
// about.
describe("spec 198: reopen", () => {
  // Spec 270: `reopen` against an active spec is not the working case —
  // the request in REQ names "81-queue-and-runner", which `resolve`
  // lists in `specFolders`, never `archivedFolders`.
  test("a reopen is refused when the target spec is already active", () => {
    const r = parseJobRequest({ ...REQ, steps: ["reopen"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("already active");
  });

  // It is queueable, not a stage a spec passes through: `explore` and
  // `manifest` are in `WORKFLOW_STEPS` for the same reason, and neither
  // draws a phase box.
  test("is not one of the phases a row draws a box for", () => {
    expect([...PHASE_STEPS] as string[]).not.toContain("reopen");
  });

  // An archived spec is not among a project's `specFolders` — the page
  // drops it, deliberately — so the resolver names it in a list of its
  // own and this is what that list buys.
  const withArchived = () => ({
    specFolders: ["81-queue-and-runner"],
    archivedFolders: ["17-clean-up-console-log"],
  });

  test("an archived spec can be asked for reopen", () => {
    const r = parseJobRequest(
      { ...REQ, specFolder: "17-clean-up-console-log", steps: ["reopen"] },
      { resolve: withArchived, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(true);
  });

  // Spec 193 relies on an archived spec being refused unless its branch
  // is still open, and that exception lives in `specFolders`. Admitting
  // the archive for `reopen` must not admit it for anything else.
  test("an archived spec is refused every other step, by name", () => {
    for (const step of ["archive", "implement", "analyze"]) {
      const r = parseJobRequest(
        { ...REQ, specFolder: "17-clean-up-console-log", steps: [step] },
        { resolve: withArchived, defaults: DEFAULTS },
      );
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toContain("archived");
    }
  });

  test("a reopen bundled with a step that is not one is refused whole", () => {
    const r = parseJobRequest(
      { ...REQ, specFolder: "17-clean-up-console-log", steps: ["reopen", "analyze"] },
      { resolve: withArchived, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
  });

  // A spec nobody has heard of still hears about the folder first: the
  // step check is second, so the error a reader gets is the one that
  // explains the most.
  test("a folder in neither list is unknown, whatever the step", () => {
    const r = parseJobRequest(
      { ...REQ, specFolder: "99-never-existed", steps: ["reopen"] },
      { resolve: withArchived, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("unknown specFolder");
  });

  // A resolver that names no archived folders at all — every caller
  // before this field existed — behaves exactly as it did.
  test("a resolver with no archived list refuses an archived folder outright", () => {
    const r = parseJobRequest(
      { ...REQ, specFolder: "17-clean-up-console-log", steps: ["reopen"] },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("unknown specFolder");
  });
});

describe("spec 231: reset", () => {
  test("an active spec can be asked for reset", () => {
    const r = parseJobRequest({ ...REQ, steps: ["reset"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    expect(r.ok && r.job.steps).toEqual(["reset"]);
  });

  test("reset is not a workflow phase and is refused for an archived spec", () => {
    expect([...PHASE_STEPS] as string[]).not.toContain("reset");
    const r = parseJobRequest(
      { ...REQ, specFolder: "17-clean-up-console-log", steps: ["reset"] },
      {
        resolve: () => ({
          specFolders: ["81-queue-and-runner"],
          archivedFolders: ["17-clean-up-console-log"],
        }),
        defaults: DEFAULTS,
      },
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("archived");
  });

  test("only jobs after a successfully landed Reset belong to the current round", () => {
    const jobs = [
      { steps: ["analyze"], state: "done", createdAt: "2026-08-24T10:00:00Z" },
      { steps: ["reset"], state: "done", createdAt: "2026-08-24T11:00:00Z" },
      { steps: ["analyze"], state: "failed", createdAt: "2026-08-24T12:00:00Z" },
    ];
    expect(currentWorkRoundJobs(jobs)).toEqual([jobs[2]]);
  });

  test("a Reset still landing is not a boundary yet", () => {
    const jobs = [
      { steps: ["analyze"], state: "done", createdAt: "2026-08-24T10:00:00Z" },
      { steps: ["reset"], state: "done", landing: true, createdAt: "2026-08-24T11:00:00Z" },
    ];
    expect(currentWorkRoundJobs(jobs)).toEqual(jobs);
  });
});
