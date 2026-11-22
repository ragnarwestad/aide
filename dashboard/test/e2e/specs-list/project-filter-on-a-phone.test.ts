// A real-browser check for the Project filter at a phone's width, where the
// search line's filter triggers are hidden and the header's "…" menu stands
// in for them: its Project row opens the Project filter on Specs and on Jobs.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-project-filter-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  base = harness.start({ alsoProjects: ["beta"], extra: { queueProjects: ["aide", "beta"] } }).base;
  await new Promise((r) => setTimeout(r, 400));
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

const PHONE = { width: 390, height: 844 };
const MORE_MENU = 'header details.menu:has(a[href="/settings"])';

for (const path of ["/specs?live=0", "/?live=0"]) {
  test(`the … menu's Project row opens the Project filter at phone width on ${path} (AC-2)`, async () => {
    await page.setViewportSize(PHONE);
    await withBrowser(page.goto(`${base}${path}`), `page.goto(${path})`);
    await page.locator(`${MORE_MENU} > summary`).click();
    const more = page.locator(MORE_MENU);
    expect(await more.getByRole("button", { name: "Filter", exact: true }).isVisible()).toBe(false);
    await more.getByRole("button", { name: "Project", exact: true }).click();
    const filter = page.locator('details.menu[data-filter="project"]');
    expect(await filter.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
    await filter.locator(".menupanel a", { hasText: "beta" }).waitFor({ state: "visible" });
  });
}
