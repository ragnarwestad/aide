// Spec 478: the native beforeunload prompt is drawn by the browser/OS,
// centered on the SCREEN — reproducible only in a real browser, never
// by a unit test running transpiled source against a fake document.
// This opens a real page, dirties a tracked form, clicks an in-app link
// and checks the replacement dialog (a) sits inside the viewport, not
// off it, and (b) leaves none of nav-busy.ts's/nav-overlay.ts's own
// side effects behind once the reader chooses to stay.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { queueHarness, ran } from "../helpers/queue-server.ts";

setDefaultTimeout(20_000);

const TOKEN = "s3cret-token";
const FOLDER = "81-queue-and-runner";

const harness = queueHarness("aide-e2e-leave-app-");
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

/** The tab bar's own Projects link — a same-document, in-app link
 *  (`shell.ts`'s `tabBar()`), the one exit path this fix can intercept. */
function projectsLink() {
  return page.locator('nav.tabbar a[href="projects.html"]');
}

describe("the leave-app dialog replaces the native prompt for an in-app link (spec 478)", () => {
  test("AC-1/AC-2: dialog.leaveapp opens inside the viewport, not off it", async () => {
    await withTimeout(
      page.goto(`${base}/specs/aide/${FOLDER}?token=${TOKEN}&live=0`),
      10_000,
      "page.goto(spec page)",
    );
    await dirtyTheTrackingForm();
    await projectsLink().click();

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
    await dialog.getByRole("button", { name: "Stay" }).click();
  });

  test('pressing "Stay" leaves no stray .awaiting link and no open pageoverlay behind', async () => {
    await withTimeout(
      page.goto(`${base}/specs/aide/${FOLDER}?token=${TOKEN}&live=0`),
      10_000,
      "page.goto(spec page)",
    );
    await dirtyTheTrackingForm();
    await projectsLink().click();
    const dialog = page.locator("dialog.leaveapp");
    await dialog.waitFor({ state: "visible" });

    await dialog.getByRole("button", { name: "Stay" }).click();

    await dialog.waitFor({ state: "hidden" });
    expect(page.url()).toContain(`/specs/aide/${FOLDER}`);
    expect(await projectsLink().evaluate((el) => el.classList.contains("awaiting"))).toBe(false);
    expect(await page.locator("dialog.pageoverlay").count()).toBe(0);
  });

  test('pressing "Leave" navigates to the link\'s destination', async () => {
    await withTimeout(
      page.goto(`${base}/specs/aide/${FOLDER}?token=${TOKEN}&live=0`),
      10_000,
      "page.goto(spec page)",
    );
    await dirtyTheTrackingForm();
    await projectsLink().click();
    const dialog = page.locator("dialog.leaveapp");
    await dialog.waitFor({ state: "visible" });

    await Promise.all([
      page.waitForNavigation(),
      dialog.getByRole("button", { name: "Leave" }).click(),
    ]);
    expect(page.url()).toContain("projects.html");
  });
});
