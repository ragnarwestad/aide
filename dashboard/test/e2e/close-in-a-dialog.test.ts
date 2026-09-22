// Close on the spec page asks its question in a dialog (spec 525), and the
// close page stays what it was for a browser with script off.
//
// Not run by the session on its own: `make test` runs it, and by hand:
// `cd dashboard && bun test --timeout 20000 test/e2e/close-in-a-dialog.test.ts`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import { LIVE, harness, start } from "../archived/archived-specs-fixtures.ts";

browserDeadline();

let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await chromium.launch();
  base = start().base;
});

afterAll(async () => { await browser.close(); harness.cleanup(); });

const SPEC = `/specs/aide/${LIVE}`;
const dialog = (page: Page) => page.locator("dialog[data-progress-dialog]");

/** The spec page, with a post answered by `post` and the job it names never settling. */
async function open(post: { status: number; json: unknown }, viewport?: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  await page.route("**/api/queue/**", (route) => {
    if (route.request().method() === "POST") return route.fulfill(post);
    return route.fulfill({ json: { job: { id: "j1", state: "running" } } });
  });
  await page.goto(`${base}${SPEC}?live=0`);
  return page;
}

const ACCEPTED = { status: 200, json: { ok: true, job: { id: "j1" } } };

describe("Close asks in a dialog (AC-7)", () => {
  test("Close opens a modal with the Reason field, OK and Cancel, and the address stays (AC-2)", async () => {
    const page = await open(ACCEPTED);
    await page.getByRole("button", { name: "Close" }).click();
    await dialog(page).waitFor({ state: "visible" });
    expect(await dialog(page).evaluate((el) => (el as HTMLDialogElement).matches(":modal"))).toBe(true);
    expect(await dialog(page).locator("textarea[name=reason]").isVisible()).toBe(true);
    expect(await dialog(page).getByRole("button", { name: "OK" }).isVisible()).toBe(true);
    expect(await dialog(page).getByRole("button", { name: "Cancel" }).isVisible()).toBe(true);
    expect(new URL(page.url()).pathname).toBe(SPEC);
  });

  test("an empty press posts nothing, and the count and the paste note are drawn inside the dialog (AC-3)", async () => {
    const page = await open(ACCEPTED);
    let posts = 0;
    page.on("request", (r) => r.method() === "POST" && (posts += 1));
    await page.getByRole("button", { name: "Close" }).click();
    await dialog(page).getByRole("button", { name: "OK" }).click();
    expect(posts).toBe(0);
    expect(await dialog(page).textContent()).toContain("0 of 5000 characters");
    await dialog(page).locator("textarea").fill("x".repeat(5000));
    expect(await dialog(page).textContent()).toContain("5000 of 5000 characters");
  });

  test("a refusal is written in the box, which stays open with the reason in it, and Escape closes it (AC-5)", async () => {
    const page = await open({ status: 400, json: { error: "Give a reason that is not blank." } });
    await page.getByRole("button", { name: "Close" }).click();
    await dialog(page).locator("textarea").fill("   ");
    await dialog(page).getByRole("button", { name: "OK" }).click();
    await dialog(page).getByText("Give a reason that is not blank.").waitFor();
    expect(await dialog(page).isVisible()).toBe(true);
    expect(await dialog(page).locator("textarea").inputValue()).toBe("   ");
    expect(new URL(page.url()).pathname).toBe(SPEC);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    expect(await dialog(page).isVisible()).toBe(false);
  });

  test("an accepted post stands as Closing… through two presses of Escape (AC-6)", async () => {
    const page = await open(ACCEPTED);
    await page.getByRole("button", { name: "Close" }).click();
    await dialog(page).locator("textarea").fill("It will not work.");
    await dialog(page).getByRole("button", { name: "OK" }).click();
    await dialog(page).locator(".standingtitle").waitFor({ state: "visible" });
    expect(await dialog(page).locator("textarea").isVisible()).toBe(false);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    expect(await dialog(page).isVisible()).toBe(true);
    expect(await dialog(page).evaluate((el) => (el as HTMLDialogElement).matches(":modal"))).toBe(true);
  });

  test("Cancel closes the box on every press (AC-1)", async () => {
    const page = await open(ACCEPTED);
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: "Close" }).click();
      await dialog(page).waitFor({ state: "visible" });
      await dialog(page).getByRole("button", { name: "Cancel" }).click();
      await dialog(page).waitFor({ state: "hidden" });
    }
  });

  test("at a phone width the field and both buttons lie inside the box (AC-1)", async () => {
    const page = await open(ACCEPTED, { width: 375, height: 667 });
    await page.getByRole("button", { name: "Close" }).click();
    await dialog(page).waitFor({ state: "visible" });
    const box = (await dialog(page).boundingBox())!;
    for (const inside of [
      dialog(page).locator("textarea"),
      dialog(page).getByRole("button", { name: "OK" }),
      dialog(page).getByRole("button", { name: "Cancel" }),
    ]) {
      const b = (await inside.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(box.x);
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
    }
  });
});

describe("the button without script (AC-7)", () => {
  // AC-2: Close has no fallback page behind it (spec 527) — with script
  // off, the button does nothing at all: no navigation, and the dialog
  // it would open with script never appears.
  test("Close does nothing: no navigation, and the dialog never opens", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${base}${SPEC}?live=0`);
    await page.getByRole("button", { name: "Close" }).click();
    await page.waitForTimeout(300);
    expect(new URL(page.url()).pathname).toBe(SPEC);
    expect(await dialog(page).isVisible()).toBe(false);
  });
});
