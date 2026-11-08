// A list reached through a tab is drawn in place, with a new `<main>`: its
// row presses must still be posted from the page, not by the browser,
// which would leave the reader on the server's JSON answer.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import {
  browserDeadline,
  withBrowser,
} from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-presses-after-tab-");
let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  base = harness.start().base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

test("a row's press on the Specs list reached from Running is posted by the page, not the browser", async () => {
  const page = await browser.newPage();
  let navigations = 0;
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame())
      navigations++;
  });
  await page.route(
    (url) => url.pathname === "/api/queue",
    (route) => route.fulfill({ json: { ok: true } }),
  );
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(Running)");
  await page.locator('nav.tabbar a[href^="/specs"]:visible').first().click();
  await page.waitForURL((url) => url.pathname === "/specs");
  await page.locator("#jobrows").waitFor({ state: "attached" });
  // A row's Run form as the list draws it; this board has no checkout, so it offers no Run of its own.
  const taken = await page.evaluate(() => {
    const form = document.createElement("form");
    form.className = "rowrun";
    form.method = "post";
    form.action = "/api/queue";
    document.getElementById("jobrows")!.appendChild(form);
    const press = new SubmitEvent("submit", {
      bubbles: true,
      cancelable: true,
    });
    form.dispatchEvent(press);
    return press.defaultPrevented;
  });
  await page.waitForTimeout(300);
  expect(taken).toBe(true);
  expect(navigations).toBe(1);
  await page.close();
});
