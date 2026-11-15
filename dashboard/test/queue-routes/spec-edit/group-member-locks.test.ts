import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { queueHarness } from "../../helpers/queue-server.ts";

const harness = queueHarness("aide-group-member-locks-");
afterEach(() => harness.cleanup());
const folder = "82-next";
const actions: [string, Record<string, unknown>][] = [
  ["close", { reason: "Do not run this" }],
  ["save", { file: "1-description.md", text: "Changed" }],
  ["tracking", { dependsOn: "999" }],
  ["tick", { checksPhase: "implement", row: [], tick: [] }],
  ["approach", { approach: "A" }],
  ["delete-branch", {}],
  ["test-server", {}],
];
for (const [action, body] of actions) {
  test(`an unstarted member of a running group refuses ${action} without changing its spec or queuing work`, async () => {
    const { base, dir } = harness.start({ alsoSpecs: [folder], executionGroups: [{
      id: "group-1", project: "aide", name: "Release", members: ["81-queue-and-runner", folder],
      branch: "group/release", state: "running", completedMembers: [], jobs: [],
    }] });
    const file = join(dir, "root/aide/specs", folder, "1-description.md");
    const before = readFileSync(file, "utf-8");
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/${action}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    expect(res.status).toBe(409);
    expect(readFileSync(file, "utf-8")).toBe(before);
    expect((await (await fetch(`${base}/api/queue`)).json() as { jobs: unknown[] }).jobs).toEqual([]);
  });
}

test("a direct Run cannot start a member reserved by an active group", async () => {
  const { base } = harness.start({ alsoSpecs: [folder], executionGroups: [{
    id: "group-1", project: "aide", name: "Release", members: ["81-queue-and-runner", folder],
    branch: "group/release", state: "queued", completedMembers: [], jobs: [],
  }] });
  for (const [type, body] of [
    ["application/json", JSON.stringify({ project: "aide", specFolder: folder, steps: ["analyze"] })],
    ["application/x-www-form-urlencoded", `project=aide&specFolder=${folder}&steps=analyze`],
  ]) {
    const res = await fetch(`${base}/api/queue`, { method: "POST", headers: { "content-type": type! }, body });
    expect(res.status).toBe(409);
  }
  expect((await (await fetch(`${base}/api/queue`)).json() as { jobs: unknown[] }).jobs).toEqual([]);
});
