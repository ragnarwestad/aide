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

test("phone tabs stay on one line and keep their accessible names (AC-6)", async () => {
  const tabs = page.locator("body > nav.tabbar a.tab");
  expect(await tabs.count()).toBe(4);
  const boxes = await tabs.evaluateAll((links) => links.map((link) => link.getBoundingClientRect()));
  expect(new Set(boxes.map((box) => box.top)).size).toBe(1);
  for (const name of ["Trabajos", "Especificaciones", "Proyectos", "Programación"]) {
    expect(await page.locator(`body > nav.tabbar a[title="${name}"]`).count()).toBe(1);
  }
});

test("phone tabs show icons alone while a wider bar keeps its words (AC-6)", async () => {
  const word = page.locator('body > nav.tabbar a[href="/specs"] > .kindicon + span');
  expect(await word.count()).toBe(1);
  expect(await word.evaluate((node) => getComputedStyle(node).position)).toBe("absolute");
  await page.setViewportSize({ width: 560, height: 800 });
  expect(await word.evaluate((node) => getComputedStyle(node).position)).not.toBe("absolute");
});

test("a phone held sideways keeps the header copy on one line with icons alone (AC-6)", async () => {
  await page.setViewportSize({ width: 700, height: 390 });
  const word = page.locator('header > nav.tabbar a[href="/specs"] > .kindicon + span');
  expect(await word.count()).toBe(1);
  expect(await word.evaluate((node) => getComputedStyle(node).position)).toBe("absolute");
  const boxes = await page.locator("header > nav.tabbar a.tab").evaluateAll((links) => links.map((link) => link.getBoundingClientRect()));
  expect(new Set(boxes.map((box) => box.top)).size).toBe(1);
});
