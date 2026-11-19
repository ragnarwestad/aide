import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { queueHarness } from "../../helpers/queue-server.ts";

const harness = queueHarness("aide-group-provider-wait-");
afterEach(() => harness.cleanup());
const folders = ["81-queue-and-runner", "82-next"];
function setup() {
  const description = (position: number) => `# Member\n\n## Tracking info\n\n- **Group:** \`Release\`\n- **Group position:** ${position}\n`;
  return harness.start({
    description: description(1), alsoSpecs: [folders[1]!], alsoDescriptions: { [folders[1]!]: description(2) },
    queueMirror: JSON.stringify([{
      id: "waiting", project: "aide", specFolder: folders[0], executionGroupId: "group-1",
      steps: ["analyze", "implement"], stepIndex: 0, state: "waiting", stopReason: "provider-limit",
      usageLimitWait: { until: "2099-01-01T12:00:00Z", resetKnown: true },
      model: { analyze: "sonnet" }, provider: { analyze: "Claude" }, timeoutSec: {}, permissionMode: {}, results: [],
      createdAt: "2026-11-16T10:00:00Z", finishedAt: "2026-11-16T11:00:00Z",
    }]),
    executionGroups: [{ id: "group-1", project: "aide", name: "Release", members: folders,
      branch: "group/release", state: "stopped", currentMember: folders[0], completedMembers: [], jobs: [] }],
    extra: { queueDefaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" },
      model: { default: "sonnet" }, modelChoices: { sonnet: {}, codex: { tool: "codex" } },
      providers: { Claude: { name: "Claude", tool: "claude" }, Codex: { name: "Codex", tool: "codex" } } } },
  });
}
const post = (base: string, suffix: string, body: unknown) => fetch(`${base}/api/queue/${suffix}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

test("Stop cancels a group's automatic retry: the waiting job is cancelled", async () => {
  const { base, dir } = setup();
  const response = await post(base, "groups/group-1/action", { action: "stop" });
  expect(response.status).toBe(200);
  const jobs = (await (await fetch(`${base}/api/queue`)).json() as { jobs: any[] }).jobs;
  expect(jobs[0].state).toBe("cancelled");
  expect(jobs[0].usageLimitWait).toBeUndefined();
  expect(JSON.parse(readFileSync(join(dir, "execution-groups.json"), "utf8"))[0].stoppedByUser).toBe(true);
});

test("automatic waiting refuses a changed phase plan until Stop", async () => {
  const { base } = setup();
  expect((await post(base, "groups/group-1/action", { action: "start", memberSteps: { [folders[0]!]: ["implement"] } })).status).toBe(409);
});

test("changing provider resumes the same phases on the selected provider", async () => {
  const { base } = setup();
  const response = await post(base, `specs/aide/${folders[0]}/model`, { step: "analyze", model: "codex", provider: "Codex" });
  expect(response.status).toBe(200);
  const jobs = (await (await fetch(`${base}/api/queue`)).json() as { jobs: any[] }).jobs;
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({ state: "queued", steps: ["analyze", "implement"], stepIndex: 0,
    model: { analyze: "codex" }, provider: { analyze: "Codex" } });
  expect(jobs[0].usageLimitWait).toBeUndefined();
});

test("changing a model on the same provider keeps its reset time", async () => {
  const { base } = setup();
  expect((await post(base, `specs/aide/${folders[0]}/model`, { step: "analyze", model: "sonnet", provider: "Claude" })).status).toBe(200);
  const jobs = (await (await fetch(`${base}/api/queue`)).json() as { jobs: any[] }).jobs;
  expect(jobs[0]).toMatchObject({ state: "waiting", usageLimitWait: { until: "2099-01-01T12:00:00Z" } });
});
