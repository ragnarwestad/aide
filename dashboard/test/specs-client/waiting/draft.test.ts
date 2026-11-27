import { describe, expect, test } from "bun:test";
import { WaitingQueue } from "../../../src/queue/waiting";
import {
  entryText, losesOwnership, moveAllowed, movedIds, positionText, reconcileRows, refreshAllowed, rowControls, saveAllowed, saveBody, targetGone, type DraftRules,
} from "../../../src/specs-client/waiting/draft.ts";

// The waiting-queue editor's draft: the moves it offers, the rows a fresh
// snapshot leaves, and what a save sends and makes of a refusal.

const rules = (over: Partial<DraftRules> = {}): DraftRules => ({
  certain: true,
  present: new Set(["a", "b", "c"]),
  snapshotIds: ["a", "b", "c"],
  owner: { targetId: "b", openingIds: ["a", "b", "c"] },
  ...over,
});

describe("moving an entry", () => {
  test("an entry moves by its offset and the rest keep their order", () => {
    expect(movedIds(["a", "b", "c"], "c", -2)).toEqual(["c", "a", "b"]);
  });

  test("a move off either end of the list gives no order", () => {
    expect(movedIds(["a", "b"], "a", -1)).toEqual([]);
    expect(movedIds(["a", "b"], "b", 1)).toEqual([]);
  });

  test("a move is refused once the hold on the queue is no longer certain", () => {
    expect(moveAllowed(rules(), ["b", "a", "c"])).toBe(true);
    expect(moveAllowed(rules({ certain: false }), ["b", "a", "c"])).toBe(false);
  });

  test("a move is refused once the selected job has left the queue", () => {
    expect(moveAllowed(rules({ present: new Set(["a", "c"]) }), ["b", "a", "c"])).toBe(false);
  });

  test("the selected job may not move behind work that arrived after opening", () => {
    const arrived = rules({ snapshotIds: ["a", "b", "c"], owner: { targetId: "a", openingIds: ["a", "b"] } });
    expect(moveAllowed(arrived, ["b", "a", "c"])).toBe(true);
    expect(moveAllowed(arrived, ["b", "c", "a"])).toBe(false);
  });
});

describe("the controls on each row", () => {
  test("only the selected job's row may move or be dragged", () => {
    // Swapping a neighbour with the selected job is a legal order, yet the neighbour's own controls stay off.
    expect(rowControls(rules(), ["a", "b", "c"], "a")).toEqual({ up: true, down: true, drag: true });
    expect(rowControls(rules(), ["a", "b", "c"], "c")).toEqual({ up: true, down: true, drag: true });
    expect(rowControls(rules(), ["a", "b", "c"], "b")).toEqual({ up: false, down: false, drag: false });
  });

  test("the selected job cannot move up from the top or down from the bottom", () => {
    expect(rowControls(rules(), ["b", "a", "c"], "b").up).toBe(true);
    expect(rowControls(rules(), ["a", "c", "b"], "b").down).toBe(true);
  });

  test("the selected job may move behind any entry that was waiting when it opened, a Deploy included", () => {
    const deploy = rules({ present: new Set(["a", "deploy:aide"]), snapshotIds: ["a", "deploy:aide"], owner: { targetId: "a", openingIds: ["a", "deploy:aide"] } });
    expect(rowControls(deploy, ["a", "deploy:aide"], "a").down).toBe(false);
  });

  test("an uncertain hold disables the selected job's handle and moves", () => {
    expect(rowControls(rules({ certain: false }), ["a", "b", "c"], "b")).toEqual({ up: true, down: true, drag: true });
  });

  test("a row's place counts from one out of the whole list", () => {
    expect(positionText(["b", "a"], "b")).toBe("1/2");
    expect(positionText(["b", "a"], "a")).toBe("2/2");
  });

  test("a row names its entry's reason only when it has one", () => {
    const entry = { id: "a", project: "aide", label: "81", operation: "analyze", reason: "" };
    expect(entryText({ ...entry, reason: "waits for 80" })).toBe(`${entryText(entry)} — waits for 80`);
  });
});

describe("a fresh snapshot of the queue", () => {
  test("rows the person moved keep their place, and arrivals join at the end in the server's order", () => {
    expect(reconcileRows(["b", "a"], ["a", "b", "d", "c"])).toEqual({ removed: [], added: ["d", "c"] });
  });

  test("rows whose entry has gone leave the draft", () => {
    expect(reconcileRows(["b", "a", "c"], ["a", "c"])).toEqual({ removed: ["b"], added: [] });
  });

  test("a snapshot without the selected job is noticed", () => {
    const listed = (...ids: string[]) => ({ targetId: "b", entries: ids.map(id => ({ id, project: "p", label: id, operation: "analyze", reason: "" })) });
    expect(targetGone(listed("a", "b"))).toBe(false);
    expect(targetGone(listed("a", "c"))).toBe(true);
  });
});

describe("saving the draft", () => {
  const entry = (id: string) => ({ id, project: "p", label: id, operation: "analyze", reason: "", jobId: id });

  test("a save sends the hold's credential, the order it was issued and the draft, never the entries", () => {
    const owner = { token: "t", generation: "g", revision: 3, targetId: "b", openingIds: ["a", "b"], expiresAt: 0, entries: [entry("a")] };
    expect(saveBody(owner, ["a", "b"], ["b", "a"])).toEqual({ token: "t", generation: "g", revision: 3, snapshotIds: ["a", "b"], ids: ["b", "a"] });
  });

  test("a refusal for a lost hold or a changed order loses the hold; a refused move does not", () => {
    const refusal = (act: () => unknown) => { try { act(); } catch (error) { return (error as Error).message; } throw new Error("not refused"); };
    const q = new WaitingQueue({});
    q.reconcile([entry("a"), entry("b"), entry("c")]);
    const owner = q.open("tab", "c");
    expect(losesOwnership(refusal(() => q.save({ ...owner, token: "foreign" }, ["a", "c", "b"])))).toBe(true);
    expect(losesOwnership(refusal(() => q.save({ ...owner, revision: owner.revision + 1 }, ["a", "c", "b"])))).toBe(true);
    expect(losesOwnership(refusal(() => q.save(owner, ["b", "a", "c"])))).toBe(false);
  });
});

describe("when the editor may ask the server", () => {
  test("a snapshot is asked for and used only while the editor is open and not saving", () => {
    expect(refreshAllowed({ closed: false, saving: false })).toBe(true);
    expect(refreshAllowed({ closed: true, saving: false })).toBe(false);
    expect(refreshAllowed({ closed: false, saving: true })).toBe(false);
  });

  test("Save sends only while the hold is known to be ours, and only once at a time", () => {
    expect(saveAllowed({ certain: true, saving: false })).toBe(true);
    expect(saveAllowed({ certain: false, saving: false })).toBe(false);
    expect(saveAllowed({ certain: true, saving: true })).toBe(false);
  });
});
