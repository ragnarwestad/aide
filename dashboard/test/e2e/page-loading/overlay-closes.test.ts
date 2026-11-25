import { expect, test } from "bun:test";
import type { Browser, Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { e2eBrowser } from "../../helpers/setup/e2e-browser.ts";
import { createdJob, queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-overlay-closes-");
let browser: Browser;
let base: string;

e2eBrowser(harness, (launched) => {
  browser = launched;
  base = harness.start({ queueMirror: JSON.stringify([createdJob()]) }).base;
});

const overlayShown = (page: Page) => page.locator("dialog.pageoverlay").isVisible();

test("the loading cover of a slow page change is gone once the page is in place", async () => {
  const page = await browser.newPage();
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "fetch" && route.request().headers().accept?.includes("text/html")) {
      await new Promise((r) => setTimeout(r, 400));
    }
    await route.continue();
  });
  await withBrowser(page.goto(`${base}/`), "page.goto(Running)");
  for (const href of ["/specs", "/", "/specs", "/specs"]) {
    await page.locator(`nav.tabbar a[href="${href}"]:visible`).first().click();
    await page.waitForTimeout(300);
    expect(await overlayShown(page), `while ${href} is fetched`).toBe(true);
    await page.waitForTimeout(900);
    expect(await overlayShown(page), `after ${href} is in place`).toBe(false);
  }
  await page.close();
});
