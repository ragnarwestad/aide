import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import {
  browserDeadline,
  withBrowser,
} from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-page-change-");
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

test("a board link changes the page without replacing the header (AC-1, AC-3, AC-4, AC-8, AC-10)", async () => {
  const page = await browser.newPage();
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(Running)");
  await page.evaluate(
    () =>
      ((window as unknown as { keptHeader: Element | null }).keptHeader =
        document.querySelector("header")),
  );
  await page.locator('a[href="/specs"]:visible').first().click();
  await page.waitForURL(/\/specs$/);
  expect(
    await page.evaluate(
      () =>
        document.querySelector("header") ===
        (window as unknown as { keptHeader: Element }).keptHeader,
    ),
  ).toBe(true);
  expect(await page.locator("main").count()).toBe(1);
  await page.goBack();
  await page.waitForURL((url) => url.pathname === "/");
  await page.close();
});
