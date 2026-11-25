import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { e2eBrowser } from "../../helpers/setup/e2e-browser.ts";
import { queueHarness, ran } from "../../helpers/queue-server.ts";

browserDeadline();
const harness = queueHarness("aide-e2e-appearance-");
let page: Page;
let base: string;

e2eBrowser(harness, async (browser) => {
  page = await browser.newPage();
  const started = harness.start();
  base = started.base;
  ran(started.dir, []);
});

test("a chosen theme applies on the next page too (AC-4, AC-6)", async () => {
  await withBrowser(page.goto(`${base}/settings?tab=appearance`), "page.goto(appearance)");
  await page.getByText("Ocean", { exact: true }).click();
  expect(await page.locator("html").getAttribute("data-palette")).toBe("ocean");
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(running)");
  expect(await page.locator("html").getAttribute("data-palette")).toBe("ocean");
});
