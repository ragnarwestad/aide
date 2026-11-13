import { expect, test } from "bun:test";
import { QueueStore } from "../../../src/queue/queue.ts";
import { continueAfterAdd } from "../../../src/serve/routes/spec-edit/group-continue.ts";

const MEMBERS = ["1-first", "2-second", "3-added"];

/** A group whose last member's Implement completed before the added spec was saved. */
function leftWaiting(): { queue: QueueStore; id: string } {
  const queue = new QueueStore({
    defaults: { timeoutSec: { default: 1 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } },
    resolve: () => ({ specFolders: MEMBERS }),
  });
  const group = queue.executionGroups.create({ project: "aide", name: "Release", members: MEMBERS, branch: "group/1-first" });
  queue.executionGroups.waitForAcceptance(group.id);
  return { queue, id: group.id };
}

test("a spec added to a running group the continuation missed is queued as the group's next job (AC-4)", () => {
  const { queue, id } = leftWaiting();
  expect(continueAfterAdd(queue, id, "3-added", "running")).toBe(true);
  expect(queue.list()).toMatchObject([{ specFolder: "3-added", steps: ["analyze", "implement"], executionGroupId: id }]);
  expect(queue.executionGroups.get(id)).toMatchObject({ state: "queued", currentMember: "3-added" });
});

test("a group that was already waiting or stopped before the add is left for the user to start (AC-5)", () => {
  for (const before of ["waiting-acceptance", "stopped"] as const) {
    const { queue, id } = leftWaiting();
    expect(continueAfterAdd(queue, id, "3-added", before)).toBe(false);
    expect(queue.list()).toHaveLength(0);
  }
});
