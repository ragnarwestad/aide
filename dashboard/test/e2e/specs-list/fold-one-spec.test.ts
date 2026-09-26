// A spec's own › redraws that spec alone. Whether the rest of the list is
// really left standing, and whether a second › keeps the first row open
// when every other link on the page was drawn before it, only a browser
// answers.
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

const fold = (folder: string) => `tr.spechead[data-folder="${folder}"] a.fold[data-fold="open"]`;

test("two ›s pressed one after the other leave both rows open and the others untouched", async () => {
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
  await page.evaluate(() => {
    (document.querySelector('tr.spechead[data-folder="83-third"]') as HTMLElement & { mark?: number }).mark = 1;
  });
  const asked: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("rows=1")) asked.push(r.url());
  });
  await page.click(fold("81-queue-and-runner"));
  await page.waitForSelector(`${fold("81-queue-and-runner")}[aria-expanded="true"]`);
  await page.click(fold("82-second"));
  await page.waitForSelector(`${fold("82-second")}[aria-expanded="true"]`);
  const after = await page.evaluate(() => ({
    firstOpen: document.querySelector('tr.spechead[data-folder="81-queue-and-runner"] a.fold')!.getAttribute("aria-expanded"),
    thirdKept: (document.querySelector('tr.spechead[data-folder="83-third"]') as HTMLElement & { mark?: number }).mark,
    open: new URLSearchParams(location.search).get("open"),
  }));
  expect(after.firstOpen).toBe("true");
  expect(after.thirdKept).toBe(1);
  expect(after.open).toBe("aide/81-queue-and-runner,aide/82-second");
  expect(asked).toHaveLength(2);
  for (const url of asked) expect(url).toContain("only=");
});

// The spinner is a span: without a box of its own it draws as a sliver.
// On a phone the › is exactly as wide as the spinner, so the check
// allows a pixel of rounding.
for (const width of [1270, 390]) {
  test(`the spinner a pressed › shows has its full size and sits inside it, at ${width}px`, async () => {
    await page.setViewportSize({ width, height: 900 });
    await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/*only=*", async (route) => {
      await held;
      await route.continue();
    });
    const link = fold("83-third");
    await page.click(link);
    const m = await page.evaluate((sel) => {
      const a = document.querySelector(sel)!.getBoundingClientRect();
      const s = document.querySelector(`${sel} > .spin`)!.getBoundingClientRect();
      return { w: s.width, h: s.height, inside: s.left >= a.left - 1 && s.right <= a.right + 1 && s.top >= a.top - 1 && s.bottom <= a.bottom + 1 };
    }, link);
    release();
    await page.waitForSelector(`${link}[aria-expanded="true"]`);
    await page.unroute("**/*only=*");
    expect(m.w).toBeGreaterThanOrEqual(12);
    expect(m.h).toBeGreaterThanOrEqual(12);
    expect(m.inside).toBe(true);
  });
}
