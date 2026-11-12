import { expect, test } from "bun:test";
import { QueueStore } from "../../src/queue/queue.ts";
import { executionGroupForAction } from "../../src/serve/routes/job-actions.ts";

test("a legacy membership card resolves to a durable record for Start and Archive (AC-10)", () => {
  const queue = new QueueStore({
    defaults: { timeoutSec: { default: 1 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } },
    resolve: () => ({ specFolders: ["1-first", "2-next"] }),
  });
  const targets = [
    { project: "aide", specFolder: "1-first", group: { name: "Release 1", position: 1 } },
    { project: "aide", specFolder: "2-next", group: { name: "Release 1", position: 2 } },
  ];
  const group = executionGroupForAction(queue.executionGroups, "membership:aide:Release 1", targets);
  expect(group).toMatchObject({ project: "aide", name: "Release 1", members: ["1-first", "2-next"], state: "prepared" });
  expect(queue.executionGroups.get(group!.id)).toEqual(group);
});
