// The header's Deploy mark follows the event stream: a `deploy` event makes
// the page ask for the mark and swap it in, with no page loaded.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-deploy-mark-live-");
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

test("a deploy event draws the header's button in place (AC-6)", async () => {
  const page = await browser.newPage();
  let navigations = 0;
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navigations++;
  });
  let mark = '<button class="deploymark iconlink" type="button" data-ask="deploymarkask">(2)</button>';
  await page.route(
    (url) => url.pathname === "/api/queue/events",
    (route) => route.fulfill({ contentType: "text/event-stream", body: ": open\n\nevent: deploy\ndata: {}\n\n" }),
  );
  await page.route(
    (url) => url.pathname === "/api/deploy-mark",
    (route) => route.fulfill({ contentType: "text/html", body: mark }),
  );
  await withBrowser(page.goto(`${base}/specs`), "page.goto(Specs)");
  const button = page.locator("header button.deploymark");
  await button.waitFor({ state: "attached" });
  expect(await button.textContent()).toContain("(2)");

  mark = '<span class="deploymark" aria-hidden="true"></span>';
  await button.waitFor({ state: "detached" });
  expect(await page.locator("header span.deploymark").count()).toBe(1);
  expect(navigations).toBe(1);
  await page.close();
});
