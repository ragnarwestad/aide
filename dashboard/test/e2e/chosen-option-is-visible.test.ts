// Whether a reader can SEE which option is chosen — not whether the
// markup says so.
//
// This is the gap a unit test cannot reach. The check mark beside every
// choice is in the DOM on EVERY row; `opacity: 0` is what hides it, and
// `[aria-current] > .menucheck { opacity: 1 }` is what shows the one
// that counts. A test that asserts `aria-current="true"` passes whether
// or not anything is visible, which is exactly how the theme and
// language menus shipped with no visible mark at all: the attribute was
// right the whole time, and the stylesheet's rule reached buttons only,
// so the language menu — whose choices are links — marked nothing.
//
// Computed style is a browser's answer, so this is a browser's test.

import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { queueHarness, ran } from "../helpers/queue-server.ts";

setDefaultTimeout(20_000);

const TOKEN = "s3cret-token";
const DESKTOP = { width: 1270, height: 800 };

const harness = queueHarness("aide-e2e-chosen-option-");
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

/** Which rows in a menu show their check mark, as the browser paints it.
 *  Returns the rows' own labels so a failure names what is wrong rather
 *  than printing an index. */
async function visiblyChosen(menuSelector: string, rowSelector: string): Promise<string[]> {
  await page.locator(`${menuSelector} > summary`).click();
  return page.locator(`${menuSelector} ${rowSelector}`).evaluateAll((rows) =>
    rows
      .filter((row) => {
        const mark = row.querySelector(".menucheck");
        if (!mark) return false;
        return Number(getComputedStyle(mark).opacity) > 0.5;
      })
      .map((row) => (row.textContent ?? "").trim()),
  );
}

test("the theme menu shows a mark on exactly one choice, and it is the live one", async () => {
  await page.setViewportSize(DESKTOP);
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/)");

  const marked = await visiblyChosen(".menu.theme", "[data-theme-choice]");
  expect(marked.length).toBe(1);

  // And it follows the choice, rather than being painted on whichever
  // row happens to be first.
  await page.locator('.menu.theme [data-theme-choice="dark"]').click();
  const afterDark = await visiblyChosen(".menu.theme", "[data-theme-choice]");
  expect(afterDark.length).toBe(1);
  expect(afterDark[0]!.toLowerCase()).toContain("dark");
});

test("the language menu shows a mark on exactly one choice", async () => {
  await page.setViewportSize(DESKTOP);
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/)");

  // The language choices are LINKS, not buttons. A stylesheet rule that
  // named buttons alone left this menu with nothing visible at all,
  // while its markup was correct throughout.
  const marked = await visiblyChosen(".menu.lang", "a[href*='lang=']");
  expect(marked.length).toBe(1);
});

test("an unchosen row's mark takes up its space without being seen", async () => {
  await page.setViewportSize(DESKTOP);
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/)");
  await page.locator(".menu.theme > summary").click();

  // Hidden by opacity, not by display: the labels line up because every
  // row reserves the same space. A mark removed from the layout instead
  // would shift the chosen row's text against the others.
  const widths = await page
    .locator(".menu.theme [data-theme-choice] .menucheck")
    .evaluateAll((marks) => marks.map((m) => Math.round(m.getBoundingClientRect().width)));
  expect(widths.length).toBeGreaterThan(1);
  expect(new Set(widths).size).toBe(1);
  expect(widths[0]).toBeGreaterThan(0);
});

test("the unit menu's stored choice is the one selected after a reload", async () => {
  await page.setViewportSize(DESKTOP);
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/)");
  await page.locator(".menu.unit > summary").click();
  await page.locator('.menu.unit [data-unit-choice="tokens"]').check();

  // The server renders "$" selected every time — which unit a reader
  // picked is theirs, not the server's. Only the script restores it, and
  // only a real browser runs the script.
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/) again");
  await page.locator(".menu.unit > summary").click();
  expect(await page.locator('.menu.unit [data-unit-choice="tokens"]').isChecked()).toBe(true);
  expect(await page.locator('.menu.unit [data-unit-choice="usd"]').isChecked()).toBe(false);
});
