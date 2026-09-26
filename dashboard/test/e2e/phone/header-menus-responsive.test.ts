// A real-browser check for the header's theme/language/unit menus (spec
// 436): the one thing a string-matching unit test cannot catch is the
// nested-`<details>` hazard `2-analysis.md` names — menu-script.ts's
// closeAll() closes every open `details.menu` except the innermost one a
// click landed in, so a naive nested-<details> implementation would
// close the outer "…" menu the instant a mobile choice row inside it was
// clicked, before the choice could even register. Approach A (flat rows,
// no nested <details>) avoids this by construction; this spec is what
// would actually catch a regression back into the nested shape, in a
// real browser, at a real viewport width.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../../helpers/queue-server.ts";

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

// The codebase's one breakpoint (narrow.css) is 40rem = 640px at the
// default 16px root — 600px sits below it, 1270px is spec 336's own
// measured laptop width, already the "desktop" convention this suite's
// sibling (specs-page-layout.test.ts) uses.
const PHONE = { width: 600, height: 900 };
// The "…" menu is the one `details.menu` in the header row with no
// theme/lang/unit class of its own — the three standalone triggers
// are `details.menu` too, and a bare `details.menu` locator names
// all four.
// No element name in it: the row holding the four menus has been a
// `span` and is a `div`, and which one it is says nothing about the
// behaviour these cases check.
const MORE_MENU = "header .row > details.menu:not(.theme):not(.lang):not(.unit)";
const DESKTOP = { width: 1270, height: 800 };

test("AC-1: at desktop width, theme, language and unit each stand as their own header trigger", async () => {
  await page.setViewportSize(DESKTOP);
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
  for (const selector of [".menu.theme", ".menu.lang", ".menu.unit"]) {
    expect(await page.locator(selector).isVisible()).toBe(true);
  }
});

test("AC-2 criterion 3: at phone width, the three standalone triggers are hidden", async () => {
  await page.setViewportSize(PHONE);
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
  for (const selector of [".menu.theme", ".menu.lang", ".menu.unit"]) {
    expect(await page.locator(selector).isHidden()).toBe(true);
  }
});

test("AC-2 criterion 4: opening the … menu at phone width reveals all three choice groups", async () => {
  await page.setViewportSize(PHONE);
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
  // Named first, so a header that stops carrying the menu fails here in
  // one line rather than through a 20-second click timeout.
  expect(await page.locator(MORE_MENU).count()).toBe(1);
  await page.locator(`${MORE_MENU} > summary`).click();
  const morerows = page.locator("header .menu .morerows");
  // `href*="lang="` rather than `href^="/?lang="` (spec 435): the
  // language links now carry `currentUrl` (here `/?live=0`) ahead of
  // `lang=`, not a bare `/?lang=` prefix.
  expect(await morerows.locator("[data-theme-choice]").first().isVisible()).toBe(true);
  expect(await morerows.locator("select[data-lang-select]").first().isVisible()).toBe(true);
  expect(await morerows.locator("[data-unit-choice]").first().isVisible()).toBe(true);
});

// The nested-<details> hazard itself: a click on a flat mobile row must
// apply the choice AND leave the "…" menu open — Approach A's whole
// reason for existing, per 3-solution.md's Risk analysis item 4.
test("AC-2 criterion 5: tapping a choice row applies it and leaves the … menu open", async () => {
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

// Spec 507: each setting in the phone menu is one row — name left,
// compact control right — then a separator, then the links.
type Box = { x: number; y: number; width: number; height: number };
async function openMore(size: { width: number; height: number }, path = "/?live=0"): Promise<void> {
  await page.setViewportSize(size);
  await withBrowser(page.goto(`${base}${path}`), `page.goto(${path})`);
  await page.locator(`${MORE_MENU} > summary`).click();
}
async function box(selector: string): Promise<Box> {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  return b;
}
async function expectOneLineRows(): Promise<void> {
  for (const row of ["theme", "lang", "unit"]) {
    const caption = await box(`${MORE_MENU} .morerows.${row} .lbl`);
    const control = await box(`${MORE_MENU} .morerows.${row} > :not(.lbl)`);
    expect(caption.x + caption.width).toBeLessThanOrEqual(control.x + 0.5);
    expect((await box(`${MORE_MENU} .morerows.${row}`)).height).toBeLessThan(control.height * 2);
  }
}

test("AC-1: at 600px each setting is one line, name left and control right", async () => {
  await openMore(PHONE);
  await expectOneLineRows();
});

test("AC-1: at 360px in French the rows are one line and the panel lies inside the screen", async () => {
  await openMore({ width: 360, height: 800 }, "/?live=0&lang=fr");
  await expectOneLineRows();
  const panel = await box(`${MORE_MENU} .menupanel`);
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(360);
});

test("AC-2: tapping Light marks it, keeps the three buttons on one line and the menu open", async () => {
  await openMore(PHONE);
  await page.locator(`${MORE_MENU} [data-theme-choice="light"]`).click();
  expect(await page.locator("html").getAttribute("data-theme")).toBe("light");
  const weights = await page
    .locator(`${MORE_MENU} .morerows.theme [data-theme-choice]`)
    .evaluateAll((els) => els.map((e) => [e.getAttribute("data-theme-choice"), getComputedStyle(e).fontWeight, getComputedStyle(e).backgroundColor]));
  const marked = weights.find((w) => w[0] === "light")!;
  expect(marked[1]).toBe("600");
  for (const other of weights.filter((w) => w[0] !== "light")) expect(other[2]).not.toBe(marked[2]);
  const tops = await page.locator(`${MORE_MENU} .morerows.theme [data-theme-choice]`).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  expect(new Set(tops).size).toBe(1);
  expect(await page.locator(MORE_MENU).evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
});

test("AC-4: tapping Tokens marks it, keeps the two buttons on one line and the menu open", async () => {
  await openMore(PHONE);
  await page.locator(`${MORE_MENU} .morerows.unit label`).nth(1).click();
  expect(await page.locator("html").getAttribute("data-unit")).toBe("tokens");
  expect(await page.locator(`${MORE_MENU} [data-unit-choice="tokens"]`).isChecked()).toBe(true);
  const labels = await page
    .locator(`${MORE_MENU} .morerows.unit label`)
    .evaluateAll((els) => els.map((e) => [getComputedStyle(e.querySelector("span")!).fontWeight, getComputedStyle(e).backgroundColor, e.getBoundingClientRect().top]));
  expect(labels[1]![0]).toBe("600");
  expect(labels[1]![1]).not.toBe(labels[0]![1]);
  expect(labels[0]![2]).toBe(labels[1]![2]);
  expect(await page.locator(MORE_MENU).evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
});

test("AC-5: the separator lies between the unit row and Settings at 600px and at 900px", async () => {
  for (const width of [600, 900]) {
    await openMore({ width, height: 900 });
    const sep = await box(`${MORE_MENU} .menusep`);
    const unit = await box(`${MORE_MENU} .morerows.unit`);
    const settings = await box(`${MORE_MENU} a[href="/settings"]`);
    expect(sep.y).toBeGreaterThanOrEqual(unit.y + unit.height - 0.5);
    expect(sep.y + sep.height).toBeLessThanOrEqual(settings.y + 0.5);
  }
});

test("AC-6: choosing Deutsch reloads in German with the menu open, once", async () => {
  await openMore(PHONE);
  await Promise.all([page.waitForURL(/[?&]lang=de(&|$)/), page.locator(`${MORE_MENU} select[data-lang-select]`).selectOption({ label: "🇩🇪 Deutsch" })]);
  expect(await page.locator("html").getAttribute("lang")).toBe("de");
  expect(await page.locator(MORE_MENU).evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
  expect(await page.locator(`${MORE_MENU} select[data-lang-select] option:checked`).textContent()).toContain("Deutsch");
  await page.reload();
  expect(await page.locator(MORE_MENU).evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
});

test("AC-7: at 1270px and 960px the menu shows no setting row and no separator", async () => {
  for (const width of [1270, 960]) {
    await openMore({ width, height: 800 });
    for (const sel of [".morerows.theme", ".morerows.lang", ".morerows.unit", ".menusep"]) {
      expect(await page.locator(`${MORE_MENU} ${sel}`).isVisible()).toBe(false);
    }
  }
});
