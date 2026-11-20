import { afterEach, expect, test } from "bun:test";
import { setupQueueRoutesHarness, JOB } from "../fixtures.ts";
const { harness, start } = setupQueueRoutesHarness("waiting-editor-");
afterEach(() => harness.cleanup());
const deploy = { id: "deploy", project: "aide", specFolder: "deploy", steps: ["deploy"], stepIndex: 0, state: "queued", createdAt: "2026-11-18T10:00:00Z", timeoutSec: {}, permissionMode: {}, model: {}, results: [] };
const post = (base: string, action: string, body: unknown) => fetch(`${base}/api/queue/waiting/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("editor routes acquire exclusively, reconcile, save and release only their own token (AC-2)", async () => {
  const { base } = start({}, [], [], undefined, undefined, JSON.stringify([deploy]));
  await fetch(`${base}/api/queue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(JOB) });
  const response = await post(base, "open", { requestId: "tab-a", entryId: "job:deploy:0" });
  expect(response.status).toBe(200);
  const owner = await response.json();
  expect(owner.entries).toHaveLength(2);
  expect((await post(base, "open", { requestId: "tab-b", entryId: "job:deploy:0" })).status).toBe(409);
  expect((await post(base, "cancel", { ...owner, token: "foreign" })).status).toBe(409);
  expect((await post(base, "renew", owner)).status).toBe(200);
  expect((await post(base, "save", { ...owner, snapshotIds: owner.entries.map((e: any) => e.id), ids: owner.entries.map((e: any) => e.id) })).status).toBe(200);
  const next = await (await post(base, "open", { requestId: "tab-b", entryId: "job:deploy:0" })).json();
  expect((await post(base, "cancel", owner)).status).toBe(409);
  expect((await post(base, "cancel", next)).status).toBe(200);
});
test("GET cannot pause scheduling and cross-origin acquisition is refused", async () => {
  const { base } = start({}, [], [], undefined, undefined, JSON.stringify([deploy]));
  expect((await fetch(`${base}/api/queue/waiting/open`)).status).toBe(405);
  const cross = await fetch(`${base}/api/queue/waiting/open`, { method: "POST", headers: { origin: "https://elsewhere.example", "content-type": "application/json" }, body: JSON.stringify({ requestId: "foreign" }) });
  expect(cross.status).toBe(403);
});

test("acceptance-held groups have no queue row while real waiting work remains editable (AC-4)", async () => {
  const group = { id: "release", project: "aide", name: "Release", members: ["82-next"], branch: "aide/release",
    state: "waiting-acceptance", completedMembers: ["82-next"], jobs: [] };
  const { base } = harness.start({ alsoSpecs: ["82-next"], executionGroups: [group], queueMirror: JSON.stringify([deploy]) });
  await fetch(`${base}/api/queue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(JOB) });
  const owner = await (await post(base, "open", { requestId: "group-test", entryId: "job:deploy:0" })).json();
  expect(owner.entries.map((e: any) => e.operation)).toEqual(["deploy", "analyze"]);
  expect((await post(base, "save", { ...owner, ids: owner.entries.map((e: any) => e.id) })).status).toBe(200);
});


test("only a waiting Deploy can open editing (AC-7)", async () => {
  const { base } = start();
  const added = await (await fetch(`${base}/api/queue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(JOB) })).json();
  for (const entryId of [undefined, "missing", `job:${added.job.id}:0`]) {
    expect((await post(base, "open", { requestId: "invalid", entryId })).status).toBe(400);
  }
});
