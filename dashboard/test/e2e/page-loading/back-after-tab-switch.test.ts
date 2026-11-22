// "← Back" on a page with tabs leads where the reader came from, and keeps
// doing so after a tab is clicked: every tab is a page load of its own,
// whose Referer is the page itself. Only a real browser decides what
// Referer a click sends and keeps the browser tab's storage from one load
// to the next, so this is a browser test.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../../helpers/queue-server.ts";

browserDeadline();

const FOLDER = "81-queue-and-runner";

const harness = queueHarness("aide-e2e-back-tabs-");
let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  const started = harness.start();
  base = started.base;
  ran(started.dir, []);
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

/** Where the page's Back leads, as a path. */
async function backPath(page: Page): Promise<string> {
  const href = await page.locator("a.backlink").getAttribute("href");
  return new URL(href ?? "", base).pathname;
}

/** Clicks the tab whose label is `label` and waits for its address. */
async function clickTab(page: Page, label: string): Promise<void> {
  const tab = page.locator("nav.tabbar a.tab", { hasText: label }).first();
  const href = await tab.getAttribute("href");
  await withBrowser(Promise.all([page.waitForURL(new URL(href ?? "", base).href), tab.click()]), `the ${label} tab`);
}

test("Settings opened from a spec page leads Back there after its Process tab", async () => {
  const page = await browser.newPage();
  await withBrowser(page.goto(`${base}/specs/aide/${FOLDER}?live=0`), "page.goto(spec page)");
  await page.locator('header summary[aria-label="More"]').click();
  const settings = page.locator('header a[href="/settings"]');
  await withBrowser(Promise.all([page.waitForURL(/\/settings$/), settings.click()]), "the Settings link");
  await clickTab(page, "Process");
  expect(await backPath(page)).toBe(`/specs/aide/${FOLDER}`);
});
