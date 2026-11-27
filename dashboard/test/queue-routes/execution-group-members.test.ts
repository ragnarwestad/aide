import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueHarness, ran, statusSaying } from "../helpers/queue-server.ts";
import { makeSpecsRepo } from "../helpers/specs-repo.ts";
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
  const { allImplemented = false, ...serverExtra } = extra;
  const started = harness.start({
    description: grouped("81-queue-and-runner", 1),
    alsoSpecs: ["82-next"],
    alsoDescriptions: { "82-next": grouped("82-next", 2) },
    executionGroups: record(state, undefined, allImplemented ? ["81-queue-and-runner", "82-next"] : ["81-queue-and-runner"]),
    extra: { queueDefaults: DEFAULTS, ...serverExtra },
    before: (dir) => {
      writeFileSync(join(dir, "root", "aide", "specs", "81-queue-and-runner", "4-status.md"), statusSaying(["create", "analyze", "implement"]));
      ran(dir, ["analyze", "implement"], "81-queue-and-runner");
      if (allImplemented) {
        writeFileSync(join(dir, "root", "aide", "specs", "82-next", "4-status.md"), statusSaying(["create", "analyze", "implement"]));
        ran(dir, ["analyze", "implement"], "82-next");
      }
    },
  });
  await implemented(started.base);
  await started.server.settle();
  return started;
}

const groupAction = (base: string, action: string, picks: Record<string, string> = {}) =>
  fetch(`${base}/api/queue/groups/group-1/action`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action, ...picks }) });

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
  test("saves and uses the group's Archive choice on later attempts (AC-4)", async () => {
    const { base, dir } = await twoMembers("waiting-acceptance", { allImplemented: true });
    const res = await groupAction(base, "archive", { model: "fable" });
    expect(res.status).toBe(200);
    const { job } = await res.json() as { job: { model: Record<string, string>; provider?: Record<string, string> } };
    expect(job.model.archive).toBe("fable");
    expect(job.provider?.archive).toBeUndefined();
    expect(JSON.parse(readFileSync(join(dir, "execution-groups.json"), "utf-8"))[0]).toMatchObject({ archiveModel: "fable" });
  });

  test("uses the first member's Archive choice until the group has one (AC-5)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-group-archive-picks-"));
    dirs.push(dir);
    const pendingModelsPath = join(dir, "pending-models.json");
    writeFileSync(pendingModelsPath, JSON.stringify({ "aide/81-queue-and-runner": { archive: "fable" } }));
    const { base } = await twoMembers("waiting-acceptance", { pendingModelsPath, allImplemented: true });
    const res = await groupAction(base, "archive");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { job: { model: Record<string, string> } }).job.model.archive).toBe("fable");
  });

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

describe("the group card's Remove", () => {
  const groupsIn = (dir: string): Record<string, unknown>[] => {
    const path = join(dir, "execution-groups.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : [];
  };
  const specFiles = (dir: string, folder: string): Record<string, string> => {
    const specDir = join(dir, "root", "aide", "specs", "archive", folder);
    return Object.fromEntries(readdirSync(specDir).map((file) => [file, readFileSync(join(specDir, file), "utf-8")]));
  };
  const twoArchivedMembers = (state: string) => harness.start({
    description: "# Queue - Description\n",
    archivedSpecs: {
      "79-older": { description: grouped("79-older", 1) },
      "80-earlier": { description: grouped("80-earlier", 2) },
    },
    executionGroups: [{
      ...record(state, ["79-older", "80-earlier"], ["79-older", "80-earlier"])[0],
      startedAt: "2026-11-11T10:30:00Z",
      completedAt: "2026-11-11T12:00:00Z",
      prUrl: "https://example.test/pr/1",
      jobs: [{ id: "job-1", specFolder: "79-older", logs: [{ step: "implement", sessionId: "s1" }] }],
    }],
    extra: { queueDefaults: DEFAULTS },
  });

  test("marks the completed record removed and keeps everything else in it (AC-3)", async () => {
    const { base, dir } = twoArchivedMembers("completed");
    const before = groupsIn(dir)[0]!;
    const res = await groupAction(base, "remove");
    expect(res.status).toBe(200);
    const { group } = await res.json() as { group: Record<string, unknown> };
    expect(typeof group.removedAt).toBe("string");
    expect(groupsIn(dir)).toEqual([{ ...before, removedAt: group.removedAt }]);
  });

  test("leaves every member's spec files untouched (AC-6)", async () => {
    const { base, dir } = twoArchivedMembers("completed");
    const before = ["79-older", "80-earlier"].map((folder) => specFiles(dir, folder));
    expect((await groupAction(base, "remove")).status).toBe(200);
    expect(["79-older", "80-earlier"].map((folder) => specFiles(dir, folder))).toEqual(before);
  });

  test("removes a stopped group without deleting its record or history", async () => {
    const { base, dir } = twoArchivedMembers("stopped");
    const res = await groupAction(base, "remove");
    expect(res.status).toBe(200);
    expect(groupsIn(dir)[0]?.removedAt).toBeDefined();
  });

  test.each(["running"])("refuses Remove while the group is %s", async (state) => {
    const { base, dir } = twoArchivedMembers(state);
    expect((await groupAction(base, "remove")).status).toBe(409);
    expect(groupsIn(dir)[0]?.removedAt).toBeUndefined();
  });

  test("removes a group known only from its members' Group: lines", async () => {
    const { base, dir } = harness.start({
      description: grouped("81-queue-and-runner", 1),
      alsoSpecs: ["82-next"],
      alsoDescriptions: { "82-next": grouped("82-next", 2) },
      extra: { queueDefaults: DEFAULTS },
      before: makeSpecsRepo,
    });
    const res = await fetch(`${base}/api/queue/groups/${encodeURIComponent("membership:aide:Release")}/action`, {
      method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action: "remove" }),
    });
    expect(res.status).toBe(200);
    expect(groupsIn(dir)[0]?.removedAt).toBeDefined();
  });
});


test("Remove dissolves an unfinished group's membership and preserves its spec content", async () => {
  const { base, dir } = harness.start({
    description: grouped("81-queue-and-runner", 1), alsoSpecs: ["82-next"],
    alsoDescriptions: { "82-next": grouped("82-next", 2) }, executionGroups: record("stopped"),
    extra: { queueDefaults: DEFAULTS }, before: makeSpecsRepo,
  });
  const path = join(dir, "root", "aide", "specs", "81-queue-and-runner", "1-description.md");
  const before = readFileSync(path, "utf-8");
  const res = await groupAction(base, "remove");
  expect(res.status).toBe(200);
  const after = readFileSync(path, "utf-8");
  expect(after).toBe(before.replace(/^.*\*\*Group(?: position)?:\*\*.*\n/gm, ""));
  const next = await fetch(`${base}/api/queue`, { method: "POST", headers: JSON_HEADERS,
    body: JSON.stringify({ project: "aide", specFolder: "82-next", steps: ["analyze"] }) });
  expect(next.status).toBe(200);
});
