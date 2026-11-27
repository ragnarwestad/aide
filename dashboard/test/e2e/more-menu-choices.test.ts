// A real-browser check for the header's "…" menu at a phone's width:
// menu-script.ts's closeAll() closes every open `details.menu` except the
// innermost one a click landed in, so a choice row nested in its own
// <details> would close the "…" menu before the choice registered. A tap
// on a choice applies it and leaves the menu open, and choosing a
// language reloads the page in it once.
import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { t } from "../../src/i18n";
import { browserDeadline, withBrowser } from "../helpers/browser-deadline.ts";
import { e2eBrowser, pageOnRunning } from "../helpers/setup/e2e-browser.ts";
import { queueHarness } from "../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-header-menus-");
let page: Page;
let base: string;

e2eBrowser(harness, async (browser) => {
  ({ page, base } = await pageOnRunning(browser, harness));
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

test("the tab bar help opens the search explanation, and Escape shuts it", async () => {
  await page.setViewportSize(PHONE);
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
  const tabs = page.getByRole("navigation").filter({ has: page.getByLabel(t("en", "shell.tabHelpTitle")) });
  const help = tabs.getByLabel(t("en", "shell.tabHelpTitle"), { exact: true });
  await help.click({ timeout: 2000 });
  const explanation = tabs.getByText(t("en", "list.searchHelpBody"), { exact: false });
  await explanation.waitFor({ state: "visible", timeout: 2000 });
  await page.keyboard.press("Escape");
  await explanation.waitFor({ state: "hidden" });
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
