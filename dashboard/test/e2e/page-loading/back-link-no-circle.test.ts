// "← Back" is worked out from the Referer. Pressing it must not make the
// page it lands on take the page just left as the way back: the two
// would send the reader round in a circle. Only a real browser decides
// what Referer a link click sends, so this is a browser test.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-back-circle-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  const started = harness.start();
  base = started.base;
  ran(started.dir, []);
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

describe("← Back never leads back to the page it was pressed on", () => {
  test("the page Back lands on offers its own way back, not the page just left", async () => {
    // Reached from the project's page, Settings' Back goes there.
    await withBrowser(
      page.goto(`${base}/settings?live=0`, { referer: `${base}/projects/aide` }),
      "page.goto(Settings)",
    );
    const back = page.locator("a.backlink");
    expect(await back.getAttribute("href")).toBe("/projects/aide");
    await withBrowser(Promise.all([page.waitForURL(/\/projects\/aide$/), back.click()]), "Back to the project");
    // The project page's own Back is its usual one, not Settings.
    expect(await page.locator("a.backlink").getAttribute("href")).not.toContain("/settings");
  });
});
