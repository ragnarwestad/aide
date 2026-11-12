// Scheduled jobs remain in history, so their old dismiss endpoint no longer
// exists. Failed-create dismissal has its own route and tests.

import { afterEach, expect, test } from "bun:test";
import { setupQueueRoutesHarness } from "../../fixtures.ts";

const { harness } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

test("scheduled-job dismiss routes answer 404 (AC-10)", async () => {
  const { base } = harness.start();
  for (const path of ["/api/queue/j1/dismiss", "/api/queue/jobs/j1/dismiss"]) {
    const response = await fetch(`${base}${path}`, { method: "POST" });
    expect(response.status).toBe(404);
  }
});
