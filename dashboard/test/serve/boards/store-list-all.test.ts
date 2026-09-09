// REQ-3 (spec 425): the board-wide overview needs every tracked board
// WITH the project/specFolder it belongs to — `all()` alone drops that
// half of the key (spec 388's own REQ-10 port-collision check never
// needed it).

import { describe, expect, test } from "bun:test";
import { BoardStore, type BoardEntry } from "../../../src/serve/boards/store.ts";

const entry = (overrides: Partial<BoardEntry> = {}): BoardEntry => ({
  branch: "aide/150-x",
  commit: "abc123",
  port: 8801,
  wrapperPid: 111,
  workDir: "/tmp/aide-board-list-all",
  logPath: "/tmp/aide-board-list-all/board.log",
  status: "running",
  startedAt: "2026-09-09T00:00:00.000Z",
  ...overrides,
});

describe("BoardStore.listAll", () => {
  test("returns every tracked board, with its project and specFolder", () => {
    const store = new BoardStore();
    store.set("aide", "150-x", entry());
    store.set("woodstack", "9-y", entry({ branch: "aide/9-y", port: 8802 }));
    const all = store.listAll();
    expect(all).toHaveLength(2);
    expect(all).toContainEqual({ project: "aide", specFolder: "150-x", entry: entry() });
    expect(all).toContainEqual({
      project: "woodstack",
      specFolder: "9-y",
      entry: entry({ branch: "aide/9-y", port: 8802 }),
    });
  });

  test("an empty store returns an empty array", () => {
    expect(new BoardStore().listAll()).toEqual([]);
  });

  test("all() is unaffected — it still drops the project/specFolder key", () => {
    const store = new BoardStore();
    store.set("aide", "150-x", entry());
    expect(store.all()).toEqual([entry()]);
  });
});
