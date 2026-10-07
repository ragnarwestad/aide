// Who the board asks GitHub about a branch's preview, and what it keeps.
// Only a spec of a `cloudflare-pages` project, with its branch on origin and
// no step running, is asked; an answer with no address removes the one
// kept, and a question GitHub could not answer leaves it where it was.

import { describe, expect, test } from "bun:test";
import { dropPreviewsOfRunningSteps, refreshBranchPreviews, type BranchPreviewContext } from "../../src/serve/schedules/branch-previews.ts";
import type { PreviewFrom } from "../../src/project/discover";
import type { GhRunner } from "../../src/integrations/pull-requests.ts";

const ADDRESS = "https://aide-40-x.woodstack.pages.dev";
const run = (status: string, conclusion: string | null, address = ADDRESS) =>
  JSON.stringify({
    check_runs: [{
      id: 1, name: "Cloudflare Pages", status, conclusion, app: { slug: "cloudflare-workers-and-pages" },
      output: { summary: `<tr><td><strong>Branch Preview URL:</strong></td><td><a href='${address}'>${address}</a></td></tr>` },
    }],
  });
const SUCCESS = run("completed", "success");
const BUILDING = run("in_progress", null);

function sweep(o: {
  previewFrom?: Record<string, PreviewFrom | undefined>;
  onOrigin?: string[];
  running?: string[];
  specs?: string[];
} = {}) {
  const gh = { code: 0, stdout: SUCCESS };
  const asked: { dir: string; args: string[] }[] = [];
  const ghRun: GhRunner = async (dir, args) => {
    asked.push({ dir, args });
    return { code: gh.code, stdout: gh.stdout };
  };
  const state = { onOrigin: o.onOrigin ?? ["aide/40-x"], running: o.running ?? [] };
  const branchPreviews = new Map<string, string>();
  let notified = 0;
  const ctx: BranchPreviewContext = {
    targets: () => (o.specs ?? ["40-x"]).map((specFolder) => ({ project: "woodstack", specFolder })),
    machineryProjectDir: (project) => `/code/${project}`,
    branchStatus: { peekOpenSpecBranches: () => ({ open: new Set(state.onOrigin), checkedAt: 1 }) },
    previewFrom: (project) => (o.previewFrom ?? { woodstack: "cloudflare-pages" })[project],
    stepRunning: (_project, folder) => state.running.includes(folder),
    ghRun,
    branchPreviews,
    notifyQueueChanged: () => {
      notified += 1;
    },
  };
  return { ctx, gh, asked, state, branchPreviews, notified: () => notified };
}

describe("refreshBranchPreviews", () => {
  test("a cloudflare-pages spec with its branch on origin is asked and its address kept (AC-1)", async () => {
    const { ctx, asked, branchPreviews } = sweep();
    await refreshBranchPreviews(ctx);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.dir).toBe("/code/woodstack");
    expect(asked[0]?.args.join(" ")).toContain("aide/40-x");
    expect(branchPreviews.get("woodstack/40-x")).toBe(ADDRESS);
  });

  test("command, none and unset projects are never asked and hold nothing (AC-3, AC-4)", async () => {
    for (const previewFrom of [{ woodstack: "command" as const }, { woodstack: "none" as const }, {}]) {
      const { ctx, asked, branchPreviews } = sweep({ previewFrom });
      await refreshBranchPreviews(ctx);
      expect([asked.length, branchPreviews.size]).toEqual([0, 0]);
    }
  });

  test("a branch origin does not hold is not asked (AC-5)", async () => {
    const { ctx, asked, branchPreviews } = sweep({ onOrigin: [] });
    await refreshBranchPreviews(ctx);
    expect([asked.length, branchPreviews.size]).toEqual([0, 0]);
  });

  test("a newer build still running removes the address, and the open page is told once (AC-2)", async () => {
    const { ctx, gh, branchPreviews, notified } = sweep();
    await refreshBranchPreviews(ctx);
    expect(notified()).toBe(1);

    gh.stdout = BUILDING;
    await refreshBranchPreviews(ctx);
    expect(branchPreviews.size).toBe(0);
    expect(notified()).toBe(2);

    await refreshBranchPreviews(ctx);
    expect(notified()).toBe(2);
  });

  test("a spec with a step running is not asked and its kept address is dropped (AC-2)", async () => {
    const { ctx, asked, branchPreviews, state, notified } = sweep();
    await refreshBranchPreviews(ctx);
    state.running = ["40-x"];
    asked.length = 0;
    await refreshBranchPreviews(ctx);
    expect([asked.length, branchPreviews.size, notified()]).toEqual([0, 0, 2]);

    state.running = [];
    await refreshBranchPreviews(ctx);
    expect(branchPreviews.get("woodstack/40-x")).toBe(ADDRESS);
  });

  test("a gh that fails, or answers nonsense, leaves the kept address where it was (AC-2)", async () => {
    const { ctx, gh, branchPreviews, notified } = sweep();
    await refreshBranchPreviews(ctx);

    gh.code = 1;
    await refreshBranchPreviews(ctx);
    gh.code = 0;
    gh.stdout = "oops";
    await refreshBranchPreviews(ctx);
    expect(branchPreviews.get("woodstack/40-x")).toBe(ADDRESS);
    expect(notified()).toBe(1);
  });

  test("a spec no longer eligible loses its address (AC-4)", async () => {
    const { ctx, branchPreviews, state } = sweep();
    await refreshBranchPreviews(ctx);
    state.onOrigin = [];
    await refreshBranchPreviews(ctx);
    expect(branchPreviews.size).toBe(0);
  });

  test("a tick that finds the same answers sends no event (AC-1)", async () => {
    const { ctx, notified } = sweep();
    await refreshBranchPreviews(ctx);
    await refreshBranchPreviews(ctx);
    await refreshBranchPreviews(ctx);
    expect(notified()).toBe(1);
  });

  test("a tick that begins while another is running asks nothing", async () => {
    const { ctx, asked } = sweep();
    await Promise.all([refreshBranchPreviews(ctx), refreshBranchPreviews(ctx)]);
    expect(asked).toHaveLength(1);
  });

  test("a step seen running between two sweeps drops the address, so it is not back when the step ends (AC-2)", async () => {
    const { ctx, branchPreviews, state, notified } = sweep();
    await refreshBranchPreviews(ctx);
    state.running = ["40-x"];
    dropPreviewsOfRunningSteps(ctx);
    state.running = [];
    expect([branchPreviews.size, notified()]).toEqual([0, 2]);
  });
});
