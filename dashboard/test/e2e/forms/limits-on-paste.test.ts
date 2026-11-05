// A real-browser check for the length counts: a paste is the one
// place the browser's own truncation and the script's measurement meet, and
// a unit test can only stand in for the truncation.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-limits-on-paste-");
let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await chromium.launch();
  base = harness.start().base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

const TITLE = '#new-spec-form input[name="title"]';
const DESCRIPTION = '#new-spec-form textarea[name="description"]';

/** A page with `text` on the clipboard and a real paste into `selector`. */
async function pasteInto(browser: Browser, selector: string, text: string) {
  const context = await browser.newContext();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  const page = await context.newPage();
  await page.goto(`${base}/new?live=0`);
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.locator(selector).focus();
  // A real paste: `keyboard.insertText` raises no `paste` event.
  await page.keyboard.press("ControlOrMeta+V");
  return { context, page };
}

describe("a paste into a bounded field", () => {
  test("200 characters into Title leave 120 and the line says 80 were discarded", async () => {
    const { context, page } = await pasteInto(browser, TITLE, "y".repeat(200));
    await page.waitForFunction((sel) => (document.querySelector(sel) as HTMLInputElement).value.length === 120, TITLE);
    // Scoped to THIS field's note: the page carries one per bounded field.
    const NOTE = `${TITLE} ~ [data-limit-note]`;
    await page.waitForFunction((sel) => document.querySelector(sel)?.textContent?.includes("80 characters did not fit"), NOTE);
    await context.close();
  });
});

describe("a Description over its bound", () => {
  test("10,100 characters pasted into Description are all kept, and the line says 100 too many (AC-2, AC-4)", async () => {
    const { context, page } = await pasteInto(browser, DESCRIPTION, "y".repeat(10_100));
    await page.waitForFunction((sel) => (document.querySelector(sel) as HTMLTextAreaElement).value.length === 10_100, DESCRIPTION);
    const NOTE = `${DESCRIPTION} ~ [data-limit-note]`;
    await page.waitForFunction((sel) => /100 characters too many/.test(document.querySelector(sel)?.textContent ?? ""), NOTE);
    await context.close();
  });

  test("Create posts nothing while the Description is over, and posts once it is shortened (AC-4)", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    let posted = 0;
    await page.route("**/api/queue/create", async (route) => {
      posted++;
      await route.fulfill({ status: 200, json: { ok: true, job: { id: "j1" } } });
    });
    await page.goto(`${base}/new?live=0`);
    await page.locator('#new-spec-form select[name="project"]').selectOption("aide");
    await page.locator(TITLE).fill("A title");
    await page.locator(DESCRIPTION).fill("y".repeat(10_001));
    const create = page.getByRole("button", { name: "Create", exact: true });
    await create.click();
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    expect(posted).toBe(0);
    await page.locator(DESCRIPTION).fill("y".repeat(10_000));
    const request = page.waitForRequest("**/api/queue/create");
    await create.click();
    await request;
    expect(posted).toBe(1);
    await context.close();
  });
});
