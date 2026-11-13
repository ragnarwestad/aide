import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueHarness, ran, statusSaying } from "../helpers/queue-server.ts";
import { listUntil, rowSaysDone } from "./fixtures.ts";

const harness = queueHarness("aide-execution-group-members-");
const dirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const JSON_HEADERS = { "content-type": "application/json" };
const DEFAULTS = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
  modelChoices: { sonnet: {}, fable: {} },
};
const grouped = (folder: string, position: number) =>
  `# ${folder}\n\n## Tracking info\n\n- **Created:** \`2026-11-11\`\n- **Group:** \`Release\`\n- **Group position:** ${position}\n`;
const record = (state: string, members = ["81-queue-and-runner", "82-next"], completedMembers: string[] = []) => [{
  id: "group-1",
  project: "aide",
  name: "Release",
  members,
  branch: `aide/group-${members[0]}-release`,
  state,
  createdAt: "2026-11-11T10:00:00Z",
  completedMembers,
  jobs: [],
}];

/** The server has read the first member's Implement off git. */
const implemented = (base: string) => listUntil(base, rowSaysDone("implement"), undefined, "81's Implement done");

/** Two grouped specs, the first one through Implement. */
async function twoMembers(state: string, extra: Record<string, unknown> = {}) {
  const started = harness.start({
    description: grouped("81-queue-and-runner", 1),
    alsoSpecs: ["82-next"],
    alsoDescriptions: { "82-next": grouped("82-next", 2) },
    executionGroups: record(state, undefined, ["81-queue-and-runner"]),
    extra: { queueDefaults: DEFAULTS, ...extra },
    before: (dir) => {
      writeFileSync(join(dir, "root", "aide", "specs", "81-queue-and-runner", "4-status.md"), statusSaying(["create", "analyze", "implement"]));
      ran(dir, ["analyze", "implement"], "81-queue-and-runner");
    },
  });
  await implemented(started.base);
  return started;
}

const press = (base: string, body: object) =>
  fetch(`${base}/api/queue`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
const groupAction = (base: string, action: string) =>
  fetch(`${base}/api/queue/groups/group-1/action`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action }) });

describe("a press on a grouped spec's own row", () => {
  test("runs as the group's job, and never archives the spec on its own", async () => {
    const { base } = await twoMembers("stopped");
    const res = await press(base, { project: "aide", specFolder: "82-next", steps: ["analyze", "implement", "archive"] });
    expect(res.status).toBe(200);
    const { job } = await res.json() as { job: { steps: string[]; executionGroupId?: string } };
    expect(job.steps).toEqual(["analyze", "implement"]);
    expect(job.executionGroupId).toBe("group-1");
  });

  test("asking for Archive alone is refused and pointed at the group", async () => {
    const { base } = await twoMembers("stopped");
    const res = await press(base, { project: "aide", specFolder: "82-next", steps: ["archive"] });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toContain("Release");
  });

  test("is refused while the group already has a job queued or running", async () => {
    const { base } = await twoMembers("stopped");
    expect((await press(base, { project: "aide", specFolder: "82-next", steps: ["analyze"] })).status).toBe(200);
    const res = await press(base, { project: "aide", specFolder: "82-next", steps: ["analyze", "implement"] });
    expect(res.status).toBe(409);
  });
});

describe("the group card's Start", () => {
  test("runs the member on the models picked on its own row", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-group-picks-"));
    dirs.push(dir);
    const pendingModelsPath = join(dir, "pending-models.json");
    writeFileSync(pendingModelsPath, JSON.stringify({ "aide/82-next": { analyze: "fable", implement: "fable" } }));
    const { base } = await twoMembers("stopped", { pendingModelsPath });
    const res = await groupAction(base, "start");
    expect(res.status).toBe(200);
    const { job } = await res.json() as { job: { specFolder: string; model: Record<string, string> } };
    expect(job.specFolder).toBe("82-next");
    expect(job.model).toEqual({ analyze: "fable", implement: "fable" });
  });
});

describe("the group card's Archive", () => {
  test("archives the members still active when another member is already archived", async () => {
    const { base } = harness.start({
      description: grouped("81-queue-and-runner", 2),
      status: statusSaying(["create", "analyze", "implement"]),
      archivedSpecs: { "80-earlier": { description: grouped("80-earlier", 1) } },
      executionGroups: record("stopped", ["80-earlier", "81-queue-and-runner"], ["80-earlier", "81-queue-and-runner"]),
      extra: { queueDefaults: DEFAULTS },
      before: (dir) => ran(dir, ["analyze", "implement"], "81-queue-and-runner"),
    });
    await implemented(base);
    const res = await groupAction(base, "archive");
    expect(res.status).toBe(200);
    const { job } = await res.json() as { job: { specFolder: string; steps: string[]; executionGroupId?: string; groupMembers?: string[] } };
    expect(job).toMatchObject({ specFolder: "81-queue-and-runner", steps: ["archive"], executionGroupId: "group-1" });
    expect(job.groupMembers).toBeUndefined();
  });
});
