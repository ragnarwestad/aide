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

// The spinner stands where the chevron stood, opening a row or shutting
// it, with its full size: a span without a box of its own draws as a
// sliver. The spinner is smaller than the chevron and sits on its own
// line box, so the check allows two pixels.
for (const width of [1270, 390]) {
  for (const [how, query, expanded] of [["opening", "", "true"], ["shutting", "&open=aide%2F83-third", "false"]] as const) {
    test(`the spinner stands where the chevron was, ${how} a row at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await withBrowser(page.goto(`${base}/?live=0${query}`), "page.goto(/)");
      const link = fold("83-third");
      const centre = (r: { x: number; y: number; width: number; height: number }) => [r.x + r.width / 2, r.y + r.height / 2];
      const before = centre((await page.locator(`${link} > svg`).boundingBox())!);
      let release: () => void = () => {};
      const held = new Promise<void>((r) => (release = r));
      await page.route("**/*only=*", async (route) => {
        await held;
        await route.continue();
      });
      await page.click(link);
      const spin = await page.locator(`${link} > .spin`).boundingBox();
      release();
      await page.waitForSelector(`${link}[aria-expanded="${expanded}"]`);
      await page.unroute("**/*only=*");
      expect(spin!.width).toBeGreaterThanOrEqual(12);
      expect(spin!.height).toBeGreaterThanOrEqual(12);
      const [x, y] = centre(spin!);
      expect(Math.abs(x! - before[0]!)).toBeLessThanOrEqual(2);
      expect(Math.abs(y! - before[1]!)).toBeLessThanOrEqual(2);
    });
  }
}

// The chevron does not move when its row opens or shuts: an open row hides
// the pips line under the title, and a chevron centred in its cell rose
// with it.
for (const width of [1270, 800, 390]) {
  test(`the chevron stands at the same height open and shut, at ${width}px`, async () => {
    await page.setViewportSize({ width, height: 900 });
    const at = async (query: string) => {
      await withBrowser(page.goto(`${base}/?live=0${query}`), "page.goto(/)");
      const head = (await page.locator('tr.spechead[data-folder="83-third"]').boundingBox())!;
      const svg = (await page.locator(`${fold("83-third")} > svg`).boundingBox())!;
      return svg.y + svg.height / 2 - head.y;
    };
    const shut = await at("");
    const open = await at("&open=aide%2F83-third");
    expect(Math.abs(open - shut)).toBeLessThanOrEqual(1);
  });
}
