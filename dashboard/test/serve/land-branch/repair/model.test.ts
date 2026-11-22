import { expect, test } from "bun:test";
import type { Job, QueueDefaults } from "../../../../src/queue/queue.ts";
import { repairModel } from "../../../../src/serve/land-branch/repair/model.ts";

test("an OpenCode repair runs on a server of its own, which sees its provider's login", () => {
  const defaults = {
    model: { implement: "oc" }, modelChoices: { oc: { model: "opencode/some-model", tool: "opencode" } },
  } as unknown as QueueDefaults;
  const job = { project: "aide", model: {} } as unknown as Job;
  expect(repairModel(defaults, job, "fix it")?.argv).toContain("--standalone");
});
