// A real-browser check for the header's "…" menu at a phone's width:
// menu-script.ts's closeAll() closes every open `details.menu` except the
// innermost one a click landed in, so a choice row nested in its own
// <details> would close the "…" menu before the choice registered. A tap
// on a choice applies it and leaves the menu open, and choosing a
// language reloads the page in it once.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-header-menus-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  const started = harness.start();
  base = started.base;
  ran(started.dir, []);
  await new Promise((r) => setTimeout(r, 400));
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/?live=0)");
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

const PHONE = { width: 600, height: 900 };
// The "…" menu is the one `details.menu` in the header row with no
// theme/lang/unit class of its own — the three standalone triggers
// are `details.menu` too, and a bare `details.menu` locator names
// all four.
// No element name in it: the row holding the four menus has been a
// `span` and is a `div`, and which one it is says nothing about the
// behaviour these cases check.
const MORE_MENU = 'header details.menu:has(a[href="/settings"])';

// The nested-<details> hazard itself: a click on a flat mobile row must
// apply the choice AND leave the "…" menu open — Approach A's whole
// reason for existing, per 3-solution.md's Risk analysis item 4.
test("tapping a choice row applies it and leaves the … menu open", async () => {
  await page.setViewportSize(PHONE);
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
  const trigger = page.locator(`${MORE_MENU} > summary`);
  await trigger.click();
  const menu = page.locator(MORE_MENU);
  expect(await menu.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);

  const darkButton = page.locator('header .menu .morerows [data-theme-choice="dark"]');
  await darkButton.click();

  expect(await page.locator("html").getAttribute("data-theme")).toBe("dark");
  expect(await menu.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
});

async function openMore(size: { width: number; height: number }, path = "/?live=0"): Promise<void> {
  await page.setViewportSize(size);
  await withBrowser(page.goto(`${base}${path}`), `page.goto(${path})`);
  await page.locator(`${MORE_MENU} > summary`).click();
}

// Placed before the language case, which sets the language cookie for
// every later load on this page: these find their rows by English name.
test("the … menu's Usage row opens the Usage panel at phone width (AC-2)", async () => {
  await openMore(PHONE);
  await page.locator(MORE_MENU).getByRole("button", { name: "Usage", exact: true }).click();
  await page.locator("[data-usage-content]").waitFor({ state: "visible" });
  expect(await page.locator(MORE_MENU).evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
});

test("the … menu's Filter row opens the filter list on Jobs and Specs at phone width (AC-4, AC-5)", async () => {
  for (const path of ["/?live=0", "/specs?live=0"]) {
    await openMore(PHONE, path);
    await page.locator(MORE_MENU).getByRole("button", { name: "Filter", exact: true }).click();
    const filter = page.locator('details.menu[data-filter="state"]');
    expect(await filter.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
    await filter.locator(".menupanel a").first().waitFor({ state: "visible" });
  }
});

test("choosing Deutsch reloads in German with the menu open, once", async () => {
  await openMore(PHONE);
  await Promise.all([page.waitForURL(/[?&]lang=de(&|$)/), page.locator(`${MORE_MENU} select[data-lang-select]`).selectOption({ label: "🇩🇪 Deutsch" })]);
  expect(await page.locator("html").getAttribute("lang")).toBe("de");
  expect(await page.locator(MORE_MENU).evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
  expect(await page.locator(`${MORE_MENU} select[data-lang-select] option:checked`).textContent()).toContain("Deutsch");
  await page.reload();
  expect(await page.locator(MORE_MENU).evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
});
