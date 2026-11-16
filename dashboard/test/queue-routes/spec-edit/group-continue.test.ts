import { expect, test } from "bun:test";
import { QueueStore } from "../../../src/queue/queue.ts";
import { continueAfterEdit, continueOnceSpecsScanned } from "../../../src/serve/routes/spec-edit/group-continue.ts";

const MEMBERS = ["1-first", "2-second", "3-added"];

/** A group whose former last member completed while an edit was saved. */
function leftWaiting(): { queue: QueueStore; id: string } {
  const queue = new QueueStore({
    defaults: { timeoutSec: { default: 1 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } },
    resolve: () => ({ specFolders: MEMBERS }),
  });
  const group = queue.executionGroups.create({ project: "aide", name: "Release", members: MEMBERS, branch: "group/1-first" });
  queue.executionGroups.update(group.id, { completedMembers: ["1-first", "2-second"] });
  queue.executionGroups.waitForAcceptance(group.id);
  return { queue, id: group.id };
}

test("an unfinished member left by an edit is queued as the group's next job (AC-6)", () => {
  const { queue, id } = leftWaiting();
  expect(continueAfterEdit(queue, id, "running")).toBe(true);
  expect(queue.list()).toMatchObject([{ specFolder: "3-added", steps: ["analyze", "implement"], executionGroupId: id }]);
  expect(queue.executionGroups.get(id)).toMatchObject({ state: "queued", currentMember: "3-added" });
});

test("a group that was already waiting or stopped before the edit is left for the user to start (AC-5)", () => {
  for (const before of ["waiting-acceptance", "stopped"] as const) {
    const { queue, id } = leftWaiting();
    expect(continueAfterEdit(queue, id, before)).toBe(false);
    expect(queue.list()).toHaveLength(0);
  }
});

/** The board around the continue: its first specs sweep finished or not, and
 *  what it was told. `finishSweep` runs what waited for it. */
function board(queue: QueueStore, scanned: boolean) {
  const waiting: (() => void)[] = [];
  const told: string[] = [];
  return {
    ctx: {
      queue,
      specsScanned: () => scanned,
      whenSpecsScanned: (next: () => void) => { if (scanned) next(); else waiting.push(next); },
      tickRunner: async () => { told.push("tick"); },
      notifyQueueChanged: () => { told.push("changed"); },
    },
    told,
    finishSweep: () => { for (const next of waiting.splice(0)) next(); },
  };
}

test("before the first specs sweep, an edit leaves the added member unqueued until the sweep has finished (AC-2)", async () => {
  const { queue, id } = leftWaiting();
  const { ctx, told, finishSweep } = board(queue, false);
  await continueOnceSpecsScanned(ctx, id, "running", () => ["create", "analyze"]);
  expect(queue.list()).toHaveLength(0);
  finishSweep();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(queue.list()).toMatchObject([{ specFolder: "3-added", executionGroupId: id }]);
  expect(told).toEqual(["tick", "changed"]);
});

test("after the first specs sweep, an edit queues the added member before it answers (AC-5)", async () => {
  const { queue, id } = leftWaiting();
  const { ctx, told } = board(queue, true);
  await continueOnceSpecsScanned(ctx, id, "running", () => []);
  expect(queue.list()).toMatchObject([{ specFolder: "3-added", steps: ["analyze", "implement"] }]);
  expect(told).toEqual(["tick"]);
});
