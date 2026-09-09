// Spec 388, REQ-7: `landArchivedSpec`'s own `onLanded` stops whatever
// board is tracked for the spec, once the merge has actually landed —
// never before.
//
// The merge is REAL here, driven by a git that runs no git
// (`landing-fixtures.ts`). It used to be a `mock.module` on
// `land-branch/merge.ts`, which reads as file-local and is not: a
// `mock.module` is registered for the whole `bun test` run, so every
// other file's test of the real `landBranch` was handed the fake and
// proved nothing (2026-09-09).

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { landArchivedSpec } from "../../../src/serve/land-branch/steps.ts";
import { BoardStore } from "../../../src/serve/boards/store.ts";
import type { BoardsContext } from "../../../src/serve/boards/lifecycle.ts";
import { BRANCH, landCtx, landingGit, REPOS } from "./landing-fixtures.ts";
import type { Answer } from "../../helpers/fake-git.ts";

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
  } as unknown as BoardsContext;
}

/** A store holding one running board for `150-spec`. */
function storeWithBoard(): BoardStore {
  const store = new BoardStore();
  store.set("aide", "150-spec", {
    branch: BRANCH,
    commit: "abc123",
    port: 9000,
    wrapperPid: 4242,
    workDir: "/tmp/board",
    logPath: "/tmp/board/board.log",
    status: "running",
    pid: 5252,
    startedAt: "2026-09-05T00:00:00.000Z",
  });
  return store;
}

async function archive(store: BoardStore, over: Record<string, Answer> = {}) {
  const { ctx } = landCtx(landingGit(over).run, {
    boards: makeBoardsCtx(store),
    queue: {
      get: () => undefined,
      update: () => {},
      transition: () => ({ ok: true }),
      branchesFor: () => REPOS,
      pullRequestFor: () => ({}),
    },
  });
  await landArchivedSpec(
    ctx as unknown as Parameters<typeof landArchivedSpec>[0],
    { project: "aide", specFolder: "150-spec" } as Parameters<typeof landArchivedSpec>[1],
    { branch: BRANCH },
  );
}

beforeEach(() => {
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
  test("stops a board tracked for the spec once the merge has landed", async () => {
    const store = storeWithBoard();
    await archive(store);
    expect(killed).toEqual([{ pid: -4242, signal: "SIGTERM" }]);
    expect(store.get("aide", "150-spec")).toBeUndefined();
  });

  // The whole point of REQ-7's "once the merge has actually landed": a
  // refused merge leaves the branch, and the board still has something
  // to serve.
  test("leaves the board alone when the merge never went through", async () => {
    const store = storeWithBoard();
    await archive(store, { "merge -q --ff-only": { code: 1 }, "merge -q --no-edit": { code: 1 } });
    expect(killed).toHaveLength(0);
    expect(store.get("aide", "150-spec")).toBeDefined();
  });

  test("is a no-op when nothing is tracked for the spec", async () => {
    await archive(new BoardStore());
    expect(killed).toHaveLength(0);
  });
});
