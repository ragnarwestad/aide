import { expect, test } from "bun:test";
import { QueueStore } from "../../../src/queue/queue.ts";
import { prepareSavedExecutionGroup } from "../../../src/serve/routes/spec-edit/tracking.ts";

test("saving group membership prepares its durable record before Start (AC-1)", () => {
  const queue = new QueueStore({
    defaults: { timeoutSec: { default: 1 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } },
    resolve: () => ({ specFolders: ["1-first", "2-next"] }),
  });
  prepareSavedExecutionGroup(queue, [
    { project: "aide", specFolder: "1-first", group: { name: "Release", position: 1 } },
  ], "aide", "2-next", { name: "Release", position: 2 });
  expect(queue.executionGroups.findUnfinished("aide", "Release")).toMatchObject({
    members: ["1-first", "2-next"], state: "prepared",
  });
});
