import { afterEach, expect, test } from "bun:test";
import { setupQueueRoutesHarness, JOB } from "../fixtures.ts";
const { harness, start } = setupQueueRoutesHarness("waiting-editor-");
afterEach(() => harness.cleanup());
const post = (base: string, action: string, body: unknown) => fetch(`${base}/api/queue/waiting/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("editor routes acquire exclusively, reconcile, save and release only their own token", async () => {
  const { base } = start();
  await fetch(`${base}/api/queue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(JOB) });
  const response = await post(base, "open", { requestId: "tab-a" });
  expect(response.status).toBe(200);
  const owner = await response.json();
  expect(owner.entries).toHaveLength(1);
  expect((await post(base, "open", { requestId: "tab-b" })).status).toBe(409);
  expect((await post(base, "cancel", { ...owner, token: "foreign" })).status).toBe(409);
  expect((await post(base, "renew", owner)).status).toBe(200);
  expect((await post(base, "save", { ...owner, snapshotIds: owner.entries.map((e: any) => e.id), ids: owner.entries.map((e: any) => e.id) })).status).toBe(200);
  const next = await (await post(base, "open", { requestId: "tab-b" })).json();
  expect((await post(base, "cancel", owner)).status).toBe(409);
  expect((await post(base, "cancel", next)).status).toBe(200);
});
test("GET cannot pause scheduling and cross-origin acquisition is refused", async () => {
  const { base } = start();
  expect((await fetch(`${base}/api/queue/waiting/open`)).status).toBe(405);
  const cross = await fetch(`${base}/api/queue/waiting/open`, { method: "POST", headers: { origin: "https://elsewhere.example", "content-type": "application/json" }, body: JSON.stringify({ requestId: "foreign" }) });
  expect(cross.status).toBe(403);
});

test("acceptance-held groups have no queue row while real waiting work remains editable (AC-4)", async () => {
  const group = { id: "release", project: "aide", name: "Release", members: ["82-next"], branch: "aide/release",
    state: "waiting-acceptance", completedMembers: ["82-next"], jobs: [] };
  const { base } = harness.start({ alsoSpecs: ["82-next"], executionGroups: [group] });
  await fetch(`${base}/api/queue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(JOB) });
  const owner = await (await post(base, "open", { requestId: "group-test" })).json();
  expect(owner.entries.map((e: any) => e.operation)).toEqual(["analyze"]);
  expect((await post(base, "save", { ...owner, ids: owner.entries.map((e: any) => e.id) })).status).toBe(200);
});
