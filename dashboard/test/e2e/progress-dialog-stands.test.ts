// The Reopen and Close confirmation forms open a modal dialog on submit that
// stands while the job runs, and is not dismissed by Escape.
//
// Not run by the session: Aide is not a project where the session runs the
// e2e suite. `make test` runs it, and by hand:
// `cd dashboard && bun test --timeout 20000 test/e2e/progress-dialog-stands.test.ts`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import { ARCHIVED, STAMPED, harness, start } from "../archived/archived-specs-fixtures.ts";

browserDeadline();

let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await chromium.launch();
  base = start({}, ARCHIVED).base;
});

afterAll(async () => { await browser.close(); harness.cleanup(); });

/** The confirmation page, with the post answered by a job that never settles. */
async function open(path: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.route("**/api/queue/**", (route) => {
    const request = route.request();
    if (request.method() === "POST") return route.fulfill({ json: { ok: true, job: { id: "j1" } } });
    return route.fulfill({ json: { job: { id: "j1", state: "running" } } });
  });
  await page.goto(`${base}${path}?live=0`);
  return page;
}

async function standsThroughEscape(page: Page, title: string): Promise<void> {
  const dialog = page.locator("dialog[data-progress-dialog]");
  await dialog.waitFor({ state: "visible" });
  expect(await dialog.evaluate((el) => (el as HTMLDialogElement).matches(":modal"))).toBe(true);
  expect(await dialog.textContent()).toContain(title);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  // A second Escape closes a modal in Chromium even with its cancel prevented;
  // the close event is queued, and the dialog stands up again from there.
  await page.waitForTimeout(500);
  expect(await dialog.isVisible()).toBe(true);
  expect(await dialog.evaluate((el) => (el as HTMLDialogElement).matches(":modal"))).toBe(true);
  await page.waitForTimeout(1500);
  expect(await dialog.isVisible()).toBe(true);
}

describe("the progress dialog stands (AC-2)", () => {
  test("Reopen: a modal reading Reopening… stays open through two presses of Escape and while the job runs", async () => {
    const page = await open(`/specs/aide/${STAMPED}/reopen`);
    await page.getByRole("button", { name: "Reopen" }).click();
    await standsThroughEscape(page, "Reopening…");
  });
});
