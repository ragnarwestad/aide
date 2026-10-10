// Opening a row loads the spec's own address, so the browser's history is
// what shuts it again. Pressing the chevron, a tab inside the row and Back
// only a browser answers.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-fold-one-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  base = harness.start({ extra: {}, alsoSpecs: ["82-second", "83-third"] }).base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

const fold = (folder: string) => `tr.spechead[data-folder="${folder}"] a.fold`;
const detail = (key: string) => `tr[data-spec-detail="aide/${key}"]`;

const openRows = () =>
  page.evaluate(() => [...document.querySelectorAll("tr.spechead a.fold[aria-expanded=true]")].map((a) => a.closest("tr")!.getAttribute("data-folder")));

test("a chevron opens the spec at its own address, one row at a time, and Back shuts it (AC-3, AC-4)", async () => {
  await withBrowser(page.goto(`${base}/specs?live=0`), "page.goto(/specs)");
  expect(await openRows()).toEqual([]);

  await page.click(fold("81-queue-and-runner"));
  await page.waitForSelector(detail("81-queue-and-runner"));
  expect(new URL(page.url()).pathname).toBe("/specs/aide/81-queue-and-runner");
  expect(await openRows()).toEqual(["81-queue-and-runner"]);

  await page.click(`${detail("81-queue-and-runner")} a.tab:text-is("Analysis")`);
  await page.waitForURL(/tab=analysis/);
  await page.waitForSelector(detail("81-queue-and-runner"));
  expect(await openRows()).toEqual(["81-queue-and-runner"]);

  await page.click(fold("82-second"));
  await page.waitForSelector(detail("82-second"));
  expect(new URL(page.url()).pathname).toBe("/specs/aide/82-second");
  expect(await openRows()).toEqual(["82-second"]);
  expect(await page.$(detail("81-queue-and-runner"))).toBeNull();

  for (let i = 0; i < 3; i++) await page.goBack();
  await page.waitForURL((url) => url.pathname === "/specs");
  expect(await openRows()).toEqual([]);
  expect(await page.$("tr[data-spec-detail]")).toBeNull();
});
