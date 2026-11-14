import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../../helpers/queue-server.ts";

browserDeadline();
const harness = queueHarness("aide-e2e-appearance-");
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
afterAll(async () => { await browser.close(); harness.cleanup(); });

test("a chosen theme applies on the next page too (AC-4, AC-6)", async () => {
  await withBrowser(page.goto(`${base}/settings?tab=appearance`), "page.goto(appearance)");
  await page.getByText("Ocean", { exact: true }).click();
  expect(await page.locator("html").getAttribute("data-palette")).toBe("ocean");
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(running)");
  expect(await page.locator("html").getAttribute("data-palette")).toBe("ocean");
});
