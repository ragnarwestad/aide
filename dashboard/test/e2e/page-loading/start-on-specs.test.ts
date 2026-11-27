// The board opens on the Specs list when it starts with nothing running:
// the first page a browser tab loads is the one that moves, with no way
// Back to it. Only a real browser records a tab's history, so this is a
// browser test.
import { describe, expect, test } from "bun:test";
import type { Browser } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { e2eBrowser } from "../../helpers/setup/e2e-browser.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-start-on-specs-");
let browser: Browser;
let base: string;

e2eBrowser(harness, (launched) => {
  browser = launched;
  base = harness.start({ extra: { queueProjects: [] } }).base;
});

// No service worker: a page load over half a second is answered by its wait
// page, and this test is about the loads the reader made.
const newTab = async () => (await browser.newContext({ serviceWorkers: "block" })).newPage();

describe("a board with nothing running", () => {
  test("a browser tab whose first page is the Running tab ends on the Specs list, with no way Back to it", async () => {
    const page = await newTab();
    await withBrowser(page.goto(`${base}/`), "page.goto(/)");
    await withBrowser(page.waitForURL((url) => url.pathname === "/specs"), "the move to the Specs list");
    await page.goBack().catch(() => undefined);
    expect(new URL(page.url()).pathname).not.toBe("/");
  });
});
