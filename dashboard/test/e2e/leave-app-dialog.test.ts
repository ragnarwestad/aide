// Spec 478: the native beforeunload prompt is drawn by the browser/OS,
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

describe("the leave-app dialog replaces the native prompt for an in-app link (spec 478)", () => {
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
