// Spec 478: the native beforeunload prompt is drawn by the browser/OS,
// centered on the SCREEN — reproducible only in a real browser, never
// by a unit test running transpiled source against a fake document.
// This opens a real page, dirties a tracked form, clicks an in-app link
// and checks the replacement dialog (a) sits inside the viewport, not
// off it, and (b) leaves none of nav-busy.ts's/nav-overlay.ts's own
// side effects behind once the reader chooses to stay.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../helpers/queue-server.ts";

browserDeadline();

const FOLDER = "81-queue-and-runner";

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

/** Dirties the page through the one plain-checkbox tracked form every
 *  spec tab's own banner carries (`trackingControl()`, overview.ts) —
 *  unlike the Description tab's own WYSIWYG editor, a checkbox needs no
 *  bundle to interact with. */
async function dirtyTheTrackingForm(): Promise<void> {
  await page.locator(".trackingform input[name=\"acceptanceRequired\"]").click();
}

/** The spec page's own Back link — an in-app link to the specs list
 *  (`shell.ts`'s `backLink()`). The interceptor takes ANY `a[href]`
 *  that is not a fragment, a mail/tel link, a download or a new tab
 *  (`unsaved-changes.ts`), so the exit path only has to be a link that
 *  is actually on this page. */
function exitLink() {
  return page.locator('a.backlink[href="/"]');
}

describe("the leave-app dialog replaces the native prompt for an in-app link (spec 478)", () => {
  // Fails in one line when the page stops carrying the link these cases
  // click, rather than through a 20-second click timeout three cases
  // deep: the selector went stale once already, and a test whose exit
  // path has vanished says nothing about the dialog either way.
  test("the exit path these cases use is on the page", async () => {
    await withBrowser(
      page.goto(`${base}/specs/aide/${FOLDER}?live=0`),
      "page.goto(spec page)",
    );
    expect(await exitLink().count()).toBe(1);
  });

  test("AC-1/AC-2: dialog.leaveapp opens inside the viewport, not off it", async () => {
    await withBrowser(
      page.goto(`${base}/specs/aide/${FOLDER}?live=0`),
      "page.goto(spec page)",
    );
    await dirtyTheTrackingForm();
    await exitLink().click();

    const dialog = page.locator("dialog.leaveapp");
    await dialog.waitFor({ state: "visible" });
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

    // Cleanly closed for the next test, rather than left open.
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test('pressing Cancel leaves no stray .awaiting link and no open pageoverlay behind', async () => {
    await withBrowser(
      page.goto(`${base}/specs/aide/${FOLDER}?live=0`),
      "page.goto(spec page)",
    );
    await dirtyTheTrackingForm();
    await exitLink().click();
    const dialog = page.locator("dialog.leaveapp");
    await dialog.waitFor({ state: "visible" });

    await dialog.getByRole("button", { name: "Cancel" }).click();

    await dialog.waitFor({ state: "hidden" });
    expect(page.url()).toContain(`/specs/aide/${FOLDER}`);
    expect(await exitLink().evaluate((el) => el.classList.contains("awaiting"))).toBe(false);
    expect(await page.locator("dialog.pageoverlay").count()).toBe(0);
  });

  test('pressing OK navigates to the link\'s destination', async () => {
    await withBrowser(
      page.goto(`${base}/specs/aide/${FOLDER}?live=0`),
      "page.goto(spec page)",
    );
    await dirtyTheTrackingForm();
    await exitLink().click();
    const dialog = page.locator("dialog.leaveapp");
    await dialog.waitFor({ state: "visible" });

    await Promise.all([
      page.waitForURL((url) => new URL(url).pathname === "/"),
      dialog.getByRole("button", { name: "OK" }).click(),
    ]);
    expect(new URL(page.url()).pathname).toBe("/");
  });
});
