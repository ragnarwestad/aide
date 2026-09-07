// Spec 388, REQ-7: `landArchivedSpec`'s own `onLanded` stops whatever
// board is tracked for the spec, once the merge has actually landed —
// never before. `landBranch` itself (the merge, the push, every retry)
// is already covered by the archive-landing suite under
// test/queue-routes/landing/; this test owns exactly the one line this
// spec added — the wiring from `landArchivedSpec` to `stopBoard` — so it
// fakes `landBranch` rather than re-deriving a full merge fixture.
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Landing } from "../../../src/serve/land-branch/types.ts";
import { BoardStore } from "../../../src/serve/boards/store.ts";
import type { BoardsContext } from "../../../src/serve/boards/lifecycle.ts";

let capturedLanding: Landing | undefined;

mock.module("../../../src/serve/land-branch/merge.ts", () => ({
  landBranch: async (
    _ctx: unknown,
    _job: unknown,
    _outcome: unknown,
    landing: Landing,
  ) => {
    capturedLanding = landing;
    return { ok: true } as const;
  },
}));

const { landArchivedSpec } = await import("../../../src/serve/land-branch/steps.ts");

let killed: { pid: number; signal: string }[];
let killSpy: ReturnType<typeof spyOn>;

function makeBoardsCtx(store: BoardStore): BoardsContext {
  return {
    store,
    aideCheckout: () => "/checkout/aide",
    roundScript: () => "/checkout/aide/dashboard/test/round/run",
    roundAvailable: () => true,
    gitRun: async () => ({ code: 0, stdout: "", stderr: "" }),
    spawn: () => ({ pid: 1 }),
    isAlive: () => true,
    now: () => "2026-09-05T00:00:00.000Z",
    makeWorkDir: () => "/tmp",
    reservedPorts: () => [],
    findFreePort: async () => 9000,
    boardOnPort: async () => undefined,
  };
}

beforeEach(() => {
  capturedLanding = undefined;
  killed = [];
  killSpy = spyOn(process, "kill").mockImplementation((pid: number, signal?: string) => {
    killed.push({ pid, signal: signal ?? "" });
    return true;
  });
});

afterEach(() => {
  killSpy.mockRestore();
});

describe("landArchivedSpec's onLanded", () => {
  test("stops a board tracked for the spec once the merge has actually landed", async () => {
    const store = new BoardStore();
    store.set("aide", "150-spec", {
      branch: "aide/150-spec",
      commit: "abc123",
      port: 9000,
      wrapperPid: 4242,
      workDir: "/tmp/board",
      logPath: "/tmp/board/board.log",
      status: "running",
      pid: 5252,
      startedAt: "2026-09-05T00:00:00.000Z",
    });
    const boards = makeBoardsCtx(store);
    const ctx = { queue: { branchesFor: () => [] }, boards } as unknown as Parameters<typeof landArchivedSpec>[0];
    const job = { project: "aide", specFolder: "150-spec" } as Parameters<typeof landArchivedSpec>[1];

    await landArchivedSpec(ctx, job, {});
    expect(capturedLanding?.onLanded).toBeDefined();

    // Nothing stopped yet — `onLanded` only fires once `landBranch`
    // itself decides the merge landed, which this fake defers to the
    // caller rather than firing automatically.
    expect(killed).toHaveLength(0);
    expect(store.get("aide", "150-spec")).toBeDefined();

    await capturedLanding!.onLanded!();

    expect(killed).toEqual([{ pid: -4242, signal: "SIGTERM" }]);
    expect(store.get("aide", "150-spec")).toBeUndefined();
  });

  test("is a no-op when nothing is tracked for the spec", async () => {
    const boards = makeBoardsCtx(new BoardStore());
    const ctx = { queue: { branchesFor: () => [] }, boards } as unknown as Parameters<typeof landArchivedSpec>[0];
    const job = { project: "aide", specFolder: "no-board-here" } as Parameters<typeof landArchivedSpec>[1];

    await landArchivedSpec(ctx, job, {});
    await capturedLanding!.onLanded!();

    expect(killed).toHaveLength(0);
  });
});
