// The "?" at the right end of the site tab bar: where it sits, that a press
// opens and a second press closes it, and that its list of tabs shows at
// every width. Which of its parts shows at which width is CSS, so only a
// browser can tell.
import { expect, test } from "bun:test";
import type { Browser, Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { e2eBrowser } from "../../helpers/setup/e2e-browser.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-tab-bar-help-");
let browser: Browser;
let base: string;

e2eBrowser(harness, (launched) => {
  browser = launched;
  base = harness.start().base;
});

async function jobsPage(width: number, height: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(Jobs)");
  return page;
}

test("the \"?\" sits inside the tab bar, at its right end after the last tab (AC-1)", async () => {
  const page = await jobsPage(1280, 800);
  const bar = page.locator("body > nav.tabbar");
  const help = bar.locator("details.intro > summary");
  expect(await help.count()).toBe(1);
  const barBox = (await bar.boundingBox())!;
  const helpBox = (await help.boundingBox())!;
  const lastTab = (await bar.locator("a.tab").last().boundingBox())!;
  expect(helpBox.x).toBeGreaterThan(lastTab.x + lastTab.width);
  expect(helpBox.x + helpBox.width).toBeLessThanOrEqual(barBox.x + barBox.width);
  expect(barBox.x + barBox.width - (helpBox.x + helpBox.width)).toBeLessThan(40);
  expect(helpBox.y).toBeGreaterThanOrEqual(barBox.y);
  expect(helpBox.y + helpBox.height).toBeLessThanOrEqual(barBox.y + barBox.height);
  await page.close();
});

test("a press opens the text under the \"?\" and a second press closes it (AC-2)", async () => {
  const page = await jobsPage(1280, 800);
  const help = page.locator("body > nav.tabbar details.intro");
  await help.locator("summary").click();
  const text = help.locator("p");
  expect(await text.isVisible()).toBe(true);
  const summaryBox = (await help.locator("summary").boundingBox())!;
  expect((await text.boundingBox())!.y).toBeGreaterThan(summaryBox.y + summaryBox.height);
  await help.locator("summary").click();
  expect(await text.isVisible()).toBe(false);
  await page.close();
});

test("on a phone the text lists the tabs (AC-3)", async () => {
  const page = await jobsPage(360, 800);
  const help = page.locator("body > nav.tabbar details.intro");
  await help.locator("summary").click();
  expect(await help.locator("[data-tab-list]").isVisible()).toBe(true);
  expect(await help.locator('[data-tab-list] [data-tab="schedule"]').isVisible()).toBe(true);
  await page.close();
});

test("on a phone held sideways the header's text lists the tabs and is not clipped to the header (AC-3)", async () => {
  const page = await jobsPage(800, 360);
  const help = page.locator("header > nav.tabbar details.intro");
  await help.locator("summary").click();
  expect(await help.locator("[data-tab-list]").isVisible()).toBe(true);
  const box = (await help.locator("p").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(800);
  expect(box.y + box.height).toBeLessThanOrEqual(360);
  // Every point of the text is the text itself, not cut off by the
  // header row: the element at its bottom-centre is inside it.
  const inside = await page.evaluate(([x, y]) => {
    const hit = document.elementFromPoint(x!, y!);
    return !!hit?.closest("header > nav.tabbar details.intro > p");
  }, [box.x + box.width / 2, box.y + box.height - 4]);
  expect(inside).toBe(true);
  expect(box.height).toBeGreaterThan(60);
  await page.close();
});

test("on a desktop the text lists the tabs and keeps what the numbers count (AC-4)", async () => {
  const page = await jobsPage(1280, 800);
  const help = page.locator("body > nav.tabbar details.intro");
  await help.locator("summary").click();
  expect(await help.locator("[data-tab-list]").isVisible()).toBe(true);
  expect(await help.locator('[data-tab-list] [data-tab="schedule"]').isVisible()).toBe(true);
  expect((await help.locator("p").innerText()).trim()).not.toBe("");
  await page.close();
});
