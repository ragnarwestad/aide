// "← Back" on a page with tabs leads where the reader came from, and keeps
// doing so after a tab is clicked: every tab is a page load of its own,
// whose Referer is the page itself. Only a real browser decides what
// Referer a click sends and keeps the browser tab's storage from one load
// to the next, so this is a browser test.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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

/** Clicks the tab whose label is `label` and waits for the page it loads. */
async function clickTab(page: Page, label: string): Promise<void> {
  const tab = page.locator("nav.tabbar a.tab", { hasText: label }).first();
  await withBrowser(Promise.all([page.waitForEvent("load"), tab.click()]), `the ${label} tab`);
}

describe("← Back after switching tabs", () => {
  // One browser tab for the three cases, in order: each later one starts
  // with something already remembered for the project page.
  let page: Page;
  beforeAll(async () => {
    page = await browser.newPage();
  });

  test("the project page opened from the Specs page leads Back there after its tabs (AC-1)", async () => {
    await withBrowser(page.goto(`${base}/specs?live=0`), "page.goto(Specs)");
    const project = page.locator('#jobrows a[href="/projects/aide"]').first();
    await withBrowser(Promise.all([page.waitForURL(/\/projects\/aide$/), project.click()]), "the project link");
    expect(await backPath(page)).toBe("/specs");
    await clickTab(page, "Deploy");
    await clickTab(page, "Config");
    expect(await backPath(page)).toBe("/specs");
    await withBrowser(Promise.all([page.waitForURL(`${base}/**`), page.locator("a.backlink").click()]), "Back");
    expect(new URL(page.url()).pathname).toBe("/specs");
  });

  test("a typed address leads Back to Projects, also after a tab (AC-2)", async () => {
    await withBrowser(page.goto(`${base}/projects/aide`), "page.goto(project page)");
    expect(await backPath(page)).toBe("/projects");
    await clickTab(page, "Config");
    expect(await backPath(page)).toBe("/projects");
  });

  test("opened again from a spec's open row, Back leads to that address, not the Specs page (AC-3)", async () => {
    await withBrowser(page.goto(`${base}/specs/aide/${FOLDER}?live=0`), "page.goto(spec address)");
    const project = page.locator('#jobrows a[href="/projects/aide"]').first();
    await withBrowser(Promise.all([page.waitForURL(/\/projects\/aide$/), project.click()]), "the project link");
    await clickTab(page, "Config");
    expect(await backPath(page)).toBe(`/specs/aide/${FOLDER}`);
  });
});

test("Settings opened from a spec page leads Back there after its Process tab (AC-1)", async () => {
  const page = await browser.newPage();
  await withBrowser(page.goto(`${base}/specs/aide/${FOLDER}?live=0`), "page.goto(spec page)");
  await page.locator("header details.menu:not(.theme):not(.lang):not(.unit) > summary").click();
  const settings = page.locator('header a[href="/settings"]');
  await withBrowser(Promise.all([page.waitForURL(/\/settings$/), settings.click()]), "the Settings link");
  await clickTab(page, "Process");
  expect(await backPath(page)).toBe(`/specs/aide/${FOLDER}`);
});
