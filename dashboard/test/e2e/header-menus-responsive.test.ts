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
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { queueHarness, ran } from "../helpers/queue-server.ts";

setDefaultTimeout(20_000);

const TOKEN = "s3cret-token";

const harness = queueHarness("aide-e2e-header-menus-");
let browser: Browser;
let page: Page;
let base: string;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} did not resolve within ${ms}ms`)), ms),
    ),
  ]);
}

beforeAll(async () => {
  browser = await withTimeout(chromium.launch(), 15_000, "chromium.launch()");
  page = await browser.newPage();
  const started = harness.start({ extra: { queueToken: TOKEN } });
  base = started.base;
  ran(started.dir, []);
  await new Promise((r) => setTimeout(r, 400));
  await withTimeout(page.goto(`${base}/?token=${TOKEN}&live=0`), 10_000, "page.goto(/?token=)");
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
const MORE_MENU = "header > span.row > details.menu:not(.theme):not(.lang):not(.unit)";
const DESKTOP = { width: 1270, height: 800 };

test("AC-1: at desktop width, theme, language and unit each stand as their own header trigger", async () => {
  await page.setViewportSize(DESKTOP);
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/)");
  for (const selector of [".menu.theme", ".menu.lang", ".menu.unit"]) {
    expect(await page.locator(selector).isVisible()).toBe(true);
  }
});

test("AC-2 criterion 3: at phone width, the three standalone triggers are hidden", async () => {
  await page.setViewportSize(PHONE);
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/)");
  for (const selector of [".menu.theme", ".menu.lang", ".menu.unit"]) {
    expect(await page.locator(selector).isHidden()).toBe(true);
  }
});

test("AC-2 criterion 4: opening the … menu at phone width reveals all three choice groups", async () => {
  await page.setViewportSize(PHONE);
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/)");
  await page.locator(`${MORE_MENU} > summary`).click();
  const morerows = page.locator("header .menu .morerows");
  // `href*="lang="` rather than `href^="/?lang="` (spec 435): the
  // language links now carry `currentUrl` (here `/?live=0`) ahead of
  // `lang=`, not a bare `/?lang=` prefix.
  expect(await morerows.locator("[data-theme-choice]").first().isVisible()).toBe(true);
  expect(await morerows.locator('a[href*="lang="]').first().isVisible()).toBe(true);
  expect(await morerows.locator("[data-unit-choice]").first().isVisible()).toBe(true);
});

// The nested-<details> hazard itself: a click on a flat mobile row must
// apply the choice AND leave the "…" menu open — Approach A's whole
// reason for existing, per 3-solution.md's Risk analysis item 4.
test("AC-2 criterion 5: tapping a choice row applies it and leaves the … menu open", async () => {
  await page.setViewportSize(PHONE);
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/)");
  const trigger = page.locator(`${MORE_MENU} > summary`);
  await trigger.click();
  const menu = page.locator(MORE_MENU);
  expect(await menu.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);

  const darkButton = page.locator('header .menu .morerows [data-theme-choice="dark"]');
  await darkButton.click();

  expect(await page.locator("html").getAttribute("data-theme")).toBe("dark");
  expect(await menu.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
});
