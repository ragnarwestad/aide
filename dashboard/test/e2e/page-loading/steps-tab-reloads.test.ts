// The spec page's Steps tab and a job page reload themselves from the page
// script's timer, and only a real browser runs it: each page loads again
// about 10 s after it has arrived.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

describe("a page that follows a running step reloads itself", () => {
  const harness = queueHarness("aide-e2e-page-loading-");
  afterAll(() => harness.cleanup());

  test("the Steps tab and a job page each load again about 10 s after they arrived (AC-5)", async () => {
    const { base } = harness.start();
    const queued = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] }),
    });
    const job = ((await queued.json()) as { job: { id: string } }).job.id;
    const context = await browser.newContext();
    const loads = { steps: 0, job: 0 };
    const steps = await context.newPage();
    const jobPage = await context.newPage();
    steps.on("request", (r) => { if (r.isNavigationRequest() && r.url().includes("tab=steps")) loads.steps++; });
    jobPage.on("request", (r) => { if (r.isNavigationRequest() && r.url().includes(`/jobs/${job}`)) loads.job++; });
    try {
      await Promise.all([
        steps.goto(`${base}/specs/aide/81-queue-and-runner?tab=steps`),
        jobPage.goto(`${base}/jobs/${job}`),
      ]);
      expect(loads).toEqual({ steps: 1, job: 1 });
      await steps.waitForTimeout(12_000);
      expect(loads.steps).toBeGreaterThanOrEqual(2);
      expect(loads.job).toBeGreaterThanOrEqual(2);
    } finally {
      await context.close();
    }
  });
});
