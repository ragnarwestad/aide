// The server's routes hand every answer to the action log: a run queued
// through the API keeps the press on its job.
import { afterEach, expect, test } from "bun:test";
import { IMPLEMENTED } from "../../helpers/queue-server.ts";
import { JOB, setupQueueRoutesHarness } from "../../queue-routes/fixtures.ts";

const { harness, start } = setupQueueRoutesHarness(undefined, IMPLEMENTED);
afterEach(() => harness.cleanup());

test("a queued run keeps the press that queued it", async () => {
  const { base } = start();
  const headers = { "content-type": "application/json", accept: "application/json", "tailscale-user-login": "someone@example.test" };
  const made = (await (await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) })).json()) as { job: { id: string } };
  const listed = (await (await fetch(`${base}/api/queue`)).json()) as { jobs: { id: string; actions?: { action: string; from: string }[] }[] };
  const actions = listed.jobs.find((job) => job.id === made.job.id)?.actions;
  expect(actions).toEqual([expect.objectContaining({ action: "run", from: expect.stringContaining("someone@example.test") })]);
});
