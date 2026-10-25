// The board opens on the Specs list when it starts with nothing running,
// and only then: the first page a browser tab loads is the one that moves,
// while a click on Running and a reload later in the same tab show the
// Running tab as asked. Only a real browser keeps a tab's storage from one
// load to the next and records its history, so this is a browser test.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-start-on-specs-");
let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  base = harness.start({ extra: { queueProjects: [] } }).base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

// No service worker: a page load over half a second is answered by its wait
// page, and this test is about the loads the reader made.
const newTab = async () => (await browser.newContext({ serviceWorkers: "block" })).newPage();

describe("a board with nothing running", () => {
  test("a browser tab whose first page is the Running tab ends on the Specs list, with no way Back to it (AC-1)", async () => {
    const page = await newTab();
    await withBrowser(page.goto(`${base}/`), "page.goto(/)");
    await withBrowser(page.waitForURL(/\/specs$/), "the move to the Specs list");
    await page.goBack().catch(() => undefined);
    expect(new URL(page.url()).pathname).not.toBe("/");
  });

  test("a click on Running and a reload in a tab that has started show the Running tab (AC-3, AC-4)", async () => {
    const page = await newTab();
    await withBrowser(page.goto(`${base}/specs?live=0`), "page.goto(Specs)");
    await page.locator("nav.tabbar a.tab:visible", { hasText: "Running" }).click();
    await page.getByText("Nothing is running.", { exact: true }).waitFor();
    expect(new URL(page.url()).pathname).toBe("/");
    await withBrowser(page.reload(), "page.reload()");
    expect(new URL(page.url()).pathname).toBe("/");
    await page.getByText("Nothing is running.", { exact: true }).waitFor();
  });
});
