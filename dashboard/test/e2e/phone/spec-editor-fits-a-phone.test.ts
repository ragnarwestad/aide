// The Description tab of a spec that can be edited, on a phone. The
// markdown editor's toolbar is 713 px of buttons, and a flex item's own
// `min-width: auto` let it push the page out to 731 px on a 375 px screen
// rather than be told there was no room: the whole page then scrolled
// sideways. Told the room it has, the library collapses the rest of the
// toolbar into its own "…" menu, which it could do all along.
//
// Only a browser answers this: the editor mounts from script, and the
// toolbar's own collapse is its measurement, not ours.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { createSpecSaveHarness, savable, DESCRIPTION_TAB } from "../../spec-page/spec-save-fixtures.ts";

setDefaultTimeout(30_000);

const { harness, start } = createSpecSaveHarness("aide-e2e-spec-editor-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true });
  page = await context.newPage();
  base = start(savable("/host")).base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

test("the editor's toolbar fits the screen, and the page does not scroll sideways", async () => {
  await page.goto(`${base}${DESCRIPTION_TAB}`);
  // The mount only has a toolbar once the library has run.
  await page.locator(".toastui-editor-toolbar").waitFor();
  const m = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    screen: document.documentElement.clientWidth,
    toolbar: Math.round(document.querySelector(".toastui-editor-toolbar")!.getBoundingClientRect().width),
  }));
  expect(m.page).toBeLessThanOrEqual(m.screen);
  expect(m.toolbar).toBeLessThanOrEqual(m.screen);
});
