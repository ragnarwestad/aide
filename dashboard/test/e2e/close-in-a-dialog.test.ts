// Close on the spec page asks its question in a dialog, and the
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

/** The spec page, with its Close post answered by `post`. */
async function open(post: { status: number; json: unknown }): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.route("**/api/queue/**", (route) =>
    route.request().method() === "POST" ? route.fulfill(post) : route.continue(),
  );
  await page.goto(`${base}${SPEC}?live=0`);
  return page;
}

const ACCEPTED = { status: 200, json: { ok: true, job: { id: "j1", project: "aide", specFolder: LIVE, steps: ["close"], stepIndex: 0 } } };

describe("Close asks in a dialog", () => {
  test("Close opens a modal with the Reason field, OK and Cancel, and the address stays", async () => {
    const page = await open(ACCEPTED);
    await page.getByRole("button", { name: "Close" }).click();
    await dialog(page).waitFor({ state: "visible" });
    expect(await dialog(page).evaluate((el) => (el as HTMLDialogElement).matches(":modal"))).toBe(true);
    expect(await dialog(page).locator("textarea[name=reason]").isVisible()).toBe(true);
    expect(await dialog(page).getByRole("button", { name: "OK" }).isVisible()).toBe(true);
    expect(await dialog(page).getByRole("button", { name: "Cancel" }).isVisible()).toBe(true);
    expect(new URL(page.url()).pathname).toBe(SPEC);
  });

  test("an empty press posts nothing, and the count and the paste note are drawn inside the dialog", async () => {
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

  test("a refusal is written in the box, which stays open with the reason in it, and Escape closes it", async () => {
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

  // The Running page follows the job from there, on the job's own open row.
  test("an accepted post goes to the Running page with the job's row open", async () => {
    const page = await open(ACCEPTED);
    await page.getByRole("button", { name: "Close" }).click();
    await dialog(page).locator("textarea").fill("It will not work.");
    await dialog(page).getByRole("button", { name: "OK" }).click();
    await page.waitForURL((url) => url.pathname === "/");
    expect(new URL(page.url()).searchParams.get("open")).toBe(`aide/${LIVE}:close`);
  });

  test("Cancel closes the box on every press", async () => {
    const page = await open(ACCEPTED);
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: "Close" }).click();
      await dialog(page).waitFor({ state: "visible" });
      await dialog(page).getByRole("button", { name: "Cancel" }).click();
      await dialog(page).waitFor({ state: "hidden" });
    }
  });
});
