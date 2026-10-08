// The Jobs tab in a browser: a job queued while the page is open appears
// without loading it again, and Stop's question survives the changes that
// arrive while it is open, then OK ends the job.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-jobs-tab-");
let browser: Browser;

const running = {
  id: "run1", project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"], stepIndex: 0, state: "running",
  timeoutSec: {}, permissionMode: {}, model: {}, createdAt: "2026-10-08T03:00:00Z", startedAt: "2026-10-08T03:00:00Z",
};

const post = (base: string, body: unknown) =>
  fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

describe("the Jobs tab follows the queue", () => {
  test("a job queued while nothing runs gets its row without the page loading again (AC-2)", async () => {
    const { base } = harness.start({});
    const page = await browser.newPage();
    await page.goto(`${base}/`);
    await page.getByText("Nothing is running.").waitFor();
    let loads = 0;
    page.on("load", () => loads++);

    expect((await post(base, { project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] })).ok).toBe(true);

    await page.locator("tr[data-job]").first().waitFor({ timeout: 10_000 });
    expect(loads).toBe(0);
    await page.close();
  });
});

describe("Stop asks first (AC-5)", () => {
  test("the question stays open through a change, and OK ends the job cancelled (AC-5)", async () => {
    const { base } = harness.start({ queueMirror: JSON.stringify([running]), alsoSpecs: ["82-other"] });
    const page = await browser.newPage();
    await page.goto(`${base}/`);
    await page.locator('button[data-ask="jobask-run1"]').click();
    const box = page.locator('dialog[id="jobask-run1"]');
    await box.waitFor({ state: "visible" });

    expect((await post(base, { project: "aide", specFolder: "82-other", steps: ["analyze"] })).ok).toBe(true);
    // Longer than the page's pause between two asks, so the change has reached it.
    await page.waitForTimeout(3500);
    expect(await box.isVisible()).toBe(true);

    await box.getByRole("button", { name: "OK" }).click();
    await page.waitForLoadState("load");
    await page.waitForFunction(async () => {
      const r = await fetch("/api/queue/run1");
      return ((await r.json()) as { job: { state: string } }).job.state === "cancelled";
    });
    const job = (await (await fetch(`${base}/api/queue/run1`)).json()) as { job: { state: string } };
    expect(job.job.state).toBe("cancelled");
    await page.close();
  });
});
