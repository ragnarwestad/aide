// The New spec page reached from the list's own link is drawn in place, with
// a new `<main>`: its Spec and Options tabs must still switch in the page,
// not load the tab's address.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-new-spec-tabs-in-place-");
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

test("the New spec tabs switch without a page load when the page was drawn in place (AC-1)", async () => {
  const page = await browser.newPage();
  let navigations = 0;
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navigations++;
  });
  await withBrowser(page.goto(`${base}/specs?live=0`), "page.goto(/specs)");
  await page.locator('a[href="/new"]:visible').first().click();
  await page.waitForURL((url) => url.pathname === "/new");
  const strip = page.locator("nav[data-new-spec-tabs]");
  await strip.waitFor({ state: "visible" });
  const title = page.locator('#new-spec-form input[name="title"]');
  const options = page.locator("#new-spec-criteria-checks");

  await strip.getByRole("link", { name: "Options", exact: true }).click();
  await options.waitFor({ state: "visible" });
  expect(await title.isVisible()).toBe(false);

  await strip.getByRole("link", { name: "Spec", exact: true }).click();
  await title.waitFor({ state: "visible" });
  expect(await options.isVisible()).toBe(false);

  expect(navigations).toBe(1);
  await page.close();
});
