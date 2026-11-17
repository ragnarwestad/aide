import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-tab-bar-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  base = harness.start().base;
  await withBrowser(page.goto(`${base}/?lang=es`), "page.goto(Jobs)");
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

test("phone tabs keep their accessible names", async () => {
  const tabs = page.locator("body > nav.tabbar a.tab");
  expect(await tabs.count()).toBe(4);
  for (const name of ["Trabajos", "Especificaciones", "Proyectos", "Programación"]) {
    expect(await page.locator(`body > nav.tabbar a[title="${name}"]`).count()).toBe(1);
  }
});
