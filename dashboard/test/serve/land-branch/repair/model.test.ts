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

test("a Claude repair neither takes nor sends messages from the user's other sessions", () => {
  const defaults = {
    model: { implement: "op" }, modelChoices: { op: { model: "claude-opus-5-5", tool: "claude" } },
  } as unknown as QueueDefaults;
  const job = { project: "aide", model: {} } as unknown as Job;
  const argv = repairModel(defaults, job, "fix it")!.argv;
  const settings = JSON.parse(argv[argv.indexOf("--settings") + 1]!);
  expect(settings.crossSessionInbound).toBe("refuse");
  expect(settings.permissions.deny).toEqual(["SendMessage", "ListAgents"]);
});

test("an OpenCode repair has automations off, which would run after the repair had ended", () => {
  const board = {
    model: { implement: "oc" }, modelChoices: { oc: { model: "opencode/some-model", tool: "opencode" } },
  } as unknown as QueueDefaults;
  const job = { project: "aide", model: {} } as unknown as Job;
  const env: Record<string, string | undefined> = repairModel(board, job, "fix it")?.env ?? {};
  expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? "{}")).toEqual({ automations: false });
});
