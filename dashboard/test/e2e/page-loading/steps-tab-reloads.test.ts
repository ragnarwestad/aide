// The spec page's Steps tab carries its refresh in the body, and only a
// real browser acts on it: the page reloads itself about 10 s after it
// has arrived.
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

describe("the Steps tab reloads itself with the refresh in the body", () => {
  const harness = queueHarness("aide-e2e-page-loading-");
  afterAll(() => harness.cleanup());

  test("the browser reloads about 10 s after the second half (AC-1)", async () => {
    const { base } = harness.start();
    const context = await browser.newContext();
    const page = await context.newPage();
    let loads = 0;
    page.on("request", (r) => { if (r.isNavigationRequest() && r.url().includes("tab=steps")) loads++; });
    try {
      await page.goto(`${base}/specs/aide/81-queue-and-runner?tab=steps`);
      expect(loads).toBe(1);
      await page.waitForTimeout(12_000);
      expect(loads).toBeGreaterThanOrEqual(2);
    } finally {
      await context.close();
    }
  });
});
