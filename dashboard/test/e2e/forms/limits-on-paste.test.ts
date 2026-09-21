// A real-browser check for the length counts (spec 513): a paste is the one
// place the browser's own truncation and the script's measurement meet, and
// a unit test can only stand in for the truncation.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { queueHarness } from "../../helpers/queue-server.ts";

setDefaultTimeout(20_000);

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

describe("a paste into a bounded field", () => {
  test("5,100 characters into Description leave 5,000 and the line says 100 were discarded (AC-2)", async () => {
    const context = await browser.newContext();
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    const page = await context.newPage();
    await page.goto(`${base}/new?live=0`);
    await page.evaluate((text) => navigator.clipboard.writeText(text), "y".repeat(5100));
    const description = page.locator('textarea[name="description"]');
    await description.focus();
    // A real paste: `keyboard.insertText` raises no `paste` event.
    await page.keyboard.press("ControlOrMeta+V");
    await page.waitForFunction(() => {
      const d = document.querySelector('textarea[name="description"]') as HTMLTextAreaElement;
      return d.value.length === 5000;
    });
    // Scoped to THIS field's note: the page carries one per bounded field,
    // and a bare `[data-limit-note]` finds Title's, which has nothing to
    // say about a paste into Description and never will.
    const NOTE = 'textarea[name="description"] ~ [data-limit-note]';
    const note = page.locator(NOTE);
    await page.waitForFunction(
      (sel) => document.querySelector(sel)?.textContent?.includes("100 characters did not fit"),
      NOTE,
    );
    expect(await note.textContent()).toContain("100 characters did not fit");
    await context.close();
  });
});
