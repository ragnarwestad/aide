// Close on the spec page asks its question in a dialog (spec 525), and the
// close page stays what it was for a browser with script off.
//
// Not run by the session on its own: `make test` runs it, and by hand:
// `cd dashboard && bun test --timeout 20000 test/e2e/close-in-a-dialog.test.ts`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { stepPlan } from "../../src/queue/parse-stream";
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

/** The spec page, with a post answered by `post` and the job it names
 *  answered by `polls` in turn, the last one repeated: by default a job that
 *  never settles. */
async function open(
  post: { status: number; json: unknown },
  viewport?: { width: number; height: number },
  polls: unknown[] = [{ job: { id: "j1", state: "running" } }],
): Promise<Page> {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  let polled = 0;
  await page.route("**/api/queue/**", (route) => {
    if (route.request().method() === "POST") return route.fulfill(post);
    return route.fulfill({ json: polls[Math.min(polled++, polls.length - 1)] });
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

  test("an accepted post stands as Closing… through two presses of Escape and a click outside (AC-6, AC-2)", async () => {
    const page = await open(ACCEPTED);
    await page.getByRole("button", { name: "Close" }).click();
    await dialog(page).locator("textarea").fill("It will not work.");
    await dialog(page).getByRole("button", { name: "OK" }).click();
    await dialog(page).locator(".standingtitle").waitFor({ state: "visible" });
    expect(await dialog(page).locator("textarea").isVisible()).toBe(false);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.mouse.click(4, 4);
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
});

// The plan's own keys: the page draws one waiting line per entry, and a poll's mark moves the line with its key.
const [PLAN_PREPARING, PLAN_SCRIPT] = stepPlan("close").map((s) => ({ key: s.key, title: s.label }));
const PREPARING = PLAN_PREPARING!;
const SCRIPT = PLAN_SCRIPT!;

/** Closes the spec with a reason, so the dialog stands. */
async function closeIt(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Close" }).click();
  await dialog(page).locator("textarea").fill("It will not work.");
  await dialog(page).getByRole("button", { name: "OK" }).click();
}

describe("a standing Close lists its job's steps", () => {
  test("a poll's mark moves the planned line with its key, and the line count stays (AC-3)", async () => {
    const page = await open(ACCEPTED, undefined, [
      { job: { id: "j1", state: "running" }, marks: [{ ...PREPARING, state: "done" }] },
      { job: { id: "j1", state: "running" }, marks: [{ ...PREPARING, state: "done" }, { ...SCRIPT, state: "running" }] },
    ]);
    const planned = await dialog(page).locator("li[data-step]").count();
    expect(planned).toBe(stepPlan("close").length);
    await closeIt(page);
    await dialog(page).locator(`li[data-state="running"]`).waitFor({ state: "visible" });
    expect(await dialog(page).locator("li[data-step]").evaluateAll((lis) => lis.map((li) => (li as HTMLElement).dataset.step))).toEqual(
      stepPlan("close").map((s) => s.key),
    );
    expect(await dialog(page).locator(`li[data-step="${SCRIPT.key}"]`).getAttribute("data-state")).toBe("running");
    expect(await dialog(page).getAttribute("data-standing")).not.toBeNull();
  });

  test("a failed end shows the failed step and the reason while it stands, then the page moves on (AC-4)", async () => {
    const page = await open(ACCEPTED, undefined, [
      { job: { id: "j1", state: "running" }, marks: [{ ...PREPARING, state: "done" }, { ...SCRIPT, state: "running" }] },
      {
        job: { id: "j1", state: "failed" },
        marks: [{ ...PREPARING, state: "done" }, { ...SCRIPT, state: "failed" }],
        reason: "the close script stopped",
      },
    ]);
    await closeIt(page);
    await dialog(page).getByText("The close script stopped").waitFor({ state: "visible" });
    expect(await dialog(page).locator(`li[data-step="${SCRIPT.key}"]`).getAttribute("data-state")).toBe("failed");
    expect(await dialog(page).getAttribute("data-standing")).not.toBeNull();
    await page.waitForURL((url) => !url.search.includes("live=0"));
  });
});
