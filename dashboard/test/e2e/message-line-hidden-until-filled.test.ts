// A message line is drawn whether or not it has words yet, so the page's
// script can fill it and a screen reader hears it fill. With no words it
// must take no room and show nothing; with words it must show them beside
// its icon. How big a box is, only a browser can say.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../helpers/browser-deadline.ts";
import { queueHarness } from "../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-message-line-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  base = harness.start().base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

const box = async (selector: string) => {
  const found = await page.locator(selector).boundingBox();
  if (!found) throw new Error(`${selector} has no box at all`);
  return found;
};

test("an empty line takes no room, and a filled one is taller than its icon, which sits inside it (AC-3)", async () => {
  await withBrowser(page.goto(`${base}/settings?tab=process`), "settings page.goto");
  for (const hook of ["refused", "notice"]) {
    const empty = await box(`#settings-form p.${hook}`);
    expect({ hook, width: empty.width <= 1, height: empty.height <= 1 }).toEqual({ hook, width: true, height: true });
  }

  // Filled the way the page fills it: a refused Save (this board has no
  // queue config file to write).
  await page.fill("#process-concurrency", "3");
  await page.click("#settingsform-save");
  await withBrowser(
    page.waitForFunction(() => !!document.querySelector("#settings-form p.refused span")?.textContent),
    "the refusal written",
  );
  const line = await box("#settings-form p.refused");
  const icon = await box("#settings-form p.refused svg");
  expect(icon.height).toBe(14);
  expect(line.height).toBeGreaterThan(icon.height);
  expect(icon.x).toBeGreaterThanOrEqual(line.x);
  expect(icon.y).toBeGreaterThanOrEqual(line.y);
  expect(icon.x + icon.width).toBeLessThanOrEqual(line.x + line.width);
  expect(icon.y + icon.height).toBeLessThanOrEqual(line.y + line.height);
});
