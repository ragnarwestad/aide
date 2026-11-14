import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();
const harness = queueHarness("aide-e2e-state-width-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  base = harness.start().base;
});

afterAll(async () => { await browser.close(); harness.cleanup(); });

async function width(path: string, state: string): Promise<number> {
  await withBrowser(page.goto(`${base}${path}?live=0&state=${encodeURIComponent(state)}`), `page.goto(${path})`);
  return page.evaluate(() => document.querySelector(".menu.state > summary")!.getBoundingClientRect().width);
}

test("the state button keeps its width across selections on both lists (AC-9)", async () => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const path of ["/", "/specs"]) {
    const widths = [];
    for (const state of ["all", "not-verified", "stopped,failed", "active:all,waiting,stopped"]) widths.push(await width(path, state));
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(0.5);
  }
});
