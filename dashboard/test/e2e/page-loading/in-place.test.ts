import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { createdJob, queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-page-change-");
let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  base = harness.start({ queueMirror: JSON.stringify([createdJob()]) }).base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

test("a board link changes the page without replacing the header (AC-1, AC-3, AC-4, AC-8, AC-10)", async () => {
  const page = await browser.newPage();
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(Running)");
  await page.evaluate(() => (window as unknown as { keptHeader: Element | null }).keptHeader = document.querySelector("header"));
  await page.locator('a[href="/specs"]:visible').first().click();
  await page.waitForURL((url) => url.pathname === "/specs");
  expect(await page.evaluate(() => document.querySelector("header") === (window as unknown as { keptHeader: Element }).keptHeader)).toBe(true);
  expect(await page.locator("main").count()).toBe(1);
  await page.goBack();
  await page.waitForURL((url) => url.pathname === "/");
  await page.close();
});

test("sorting opens the loading dialog and blocks links until the list answers", async () => {
  const page = await browser.newPage();
  const release = Promise.withResolvers<void>();
  try {
    // The Specs list sorts in place; the Jobs tab keeps its own order and has no sort links.
    await page.goto(`${base}/specs?live=0`);
    const jobs = page.locator('a[href="/"]:not(.brand):visible').first();
    const box = (await jobs.boundingBox())!;
    let navigations = 0;
    await page.route((url) => url.pathname === "/" && !url.searchParams.has("rows"), (route) => {
      navigations++;
      return route.continue();
    });
    await page.route((url) => url.searchParams.get("rows") === "1", async (route) => {
      await release.promise;
      await route.fulfill({ status: 503, body: "" });
    });
    await page.locator("a.sortlink:visible").first().click();
    const cover = page.getByRole("dialog").filter({ hasText: "Loading…" });
    await cover.waitFor({ timeout: 2000 });
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.press("Escape");
    expect(navigations).toBe(0);
    expect(await cover.isVisible()).toBe(true);
    release.resolve();
    await cover.waitFor({ state: "hidden" });
    await jobs.click();
    await page.waitForURL((url) => url.pathname === "/");
    expect(navigations).toBeGreaterThan(0);
  } finally {
    release.resolve();
    await page.close();
  }
});
