// The native beforeunload prompt is drawn by the browser/OS,
// centered on the SCREEN — reproducible only in a real browser, never
// by a unit test running transpiled source against a fake document.
// This opens a real page, dirties a tracked form, clicks an in-app link
// and checks the replacement dialog leaves none of nav-busy.ts's/
// nav-overlay.ts's own side effects behind once the reader chooses to
// stay, and follows the link once the reader chooses to leave.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../helpers/queue-server.ts";

browserDeadline();


const harness = queueHarness("aide-e2e-leave-app-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  const started = harness.start();
  base = started.base;
  ran(started.dir, []);
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

/** Dirties the page through the Settings page's own tracked form: a time
 *  limit typed into, which needs no bundle to interact with. */
async function dirtyTheSettingsForm(): Promise<void> {
  await page.locator('.settingsform input[name="timeoutSec.analyze"], input[form="settings-form"][name="timeoutSec.analyze"]').first().fill("61");
}

/** The header's brand link to the Running tab, an in-app link on every page.
 *  The interceptor takes ANY `a[href]` that is not a fragment, a mail/tel
 *  link, a download or a new tab (`unsaved-changes.ts`), so the exit path
 *  only has to be a link that is actually on this page. */
function exitLink() {
  return page.locator('a.brand[href="/"]:visible').first();
}

describe("the leave-app dialog replaces the native prompt for an in-app link", () => {
  // Fails in one line when the page stops carrying the link these cases
  // click, rather than through a 20-second click timeout three cases
  // deep: the selector went stale once already, and a test whose exit
  // path has vanished says nothing about the dialog either way.
  test("the exit path these cases use is on the page", async () => {
    await withBrowser(
      page.goto(`${base}/settings`),
      "page.goto(settings page)",
    );
    expect(await exitLink().count()).toBe(1);
  });

  test('pressing Cancel leaves no stray .awaiting link and no open pageoverlay behind', async () => {
    await withBrowser(
      page.goto(`${base}/settings`),
      "page.goto(settings page)",
    );
    await dirtyTheSettingsForm();
    await exitLink().click();
    const dialog = page.locator("#leaveapp");
    await dialog.waitFor({ state: "visible" });

    await dialog.getByRole("button", { name: "Cancel" }).click();

    await dialog.waitFor({ state: "hidden" });
    expect(new URL(page.url()).pathname).toBe("/settings");
    expect(await exitLink().evaluate((el) => el.classList.contains("awaiting"))).toBe(false);
    expect(await page.locator("dialog.pageoverlay").count()).toBe(0);
  });

  test('pressing OK navigates to the link\'s destination', async () => {
    await withBrowser(
      page.goto(`${base}/settings`),
      "page.goto(settings page)",
    );
    await dirtyTheSettingsForm();
    await exitLink().click();
    const dialog = page.locator("#leaveapp");
    await dialog.waitFor({ state: "visible" });

    await Promise.all([
      page.waitForURL((url) => new URL(url).pathname === "/"),
      dialog.getByRole("button", { name: "OK" }).click(),
    ]);
    expect(new URL(page.url()).pathname).toBe("/");
  });
});

// Back runs through the in-place swap only when the page was itself reached
// in place, so Settings is reached by a link click from the Running tab,
// never by `page.goto`, which would leave Back to the native prompt.
describe("Back on a page with unsaved changes waits for the leave-app dialog", () => {
  async function dirtySettingsReachedInApp(): Promise<void> {
    await withBrowser(page.goto(`${base}/?live=0`), "page.goto(Running)");
    // The Settings link sits in the header's menu; a click on the element
    // itself is the in-app link click without opening the menu first.
    await page.locator('a[href="/settings"]').first().evaluate((el) => (el as HTMLElement).click());
    await page.waitForURL((url) => new URL(url).pathname === "/settings");
    await dirtyTheSettingsForm();
  }

  test("OK goes back to the page before (AC-1, AC-2)", async () => {
    await dirtySettingsReachedInApp();
    await page.goBack();
    const dialog = page.locator("#leaveapp");
    await dialog.waitFor({ state: "visible" });
    await Promise.all([
      page.waitForURL((url) => new URL(url).pathname === "/"),
      dialog.getByRole("button", { name: "OK" }).click(),
    ]);
    await expectSoon(async () => (await page.locator('input[name="timeoutSec.analyze"]').count()) === 0);
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("Cancel keeps the edited form and the Settings address (AC-3)", async () => {
    await dirtySettingsReachedInApp();
    await page.goBack();
    const dialog = page.locator("#leaveapp");
    await dialog.waitFor({ state: "visible" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.waitForURL((url) => new URL(url).pathname === "/settings");
    expect(await page.locator('.settingsform input[name="timeoutSec.analyze"], input[form="settings-form"][name="timeoutSec.analyze"]').first().inputValue()).toBe("61");
  });
});

/** Polls `check` until it holds or two seconds pass. */
async function expectSoon(check: () => Promise<boolean>): Promise<void> {
  const until = Date.now() + 2000;
  while (!(await check())) {
    if (Date.now() > until) throw new Error("condition did not hold within 2s");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
