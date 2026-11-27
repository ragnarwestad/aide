// Close on a spec's row asks its question in a dialog.
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
/** By attribute, since the id holds a `/`, which no CSS `#…` selector takes. */
const dialog = (page: Page) => page.locator(`dialog[id="closeask-aide/${LIVE}"]`);
/** The spec's own Close, in its row's Actions cell: every active row has one. */
const close = (page: Page) => page.locator(`tr.specstate[data-folder="${LIVE}"]`).getByRole("button", { name: "Close" });

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
  test("an empty press posts nothing", async () => {
    const page = await open(ACCEPTED);
    let posts = 0;
    page.on("request", (r) => r.method() === "POST" && (posts += 1));
    await close(page).click();
    await dialog(page).getByRole("button", { name: "OK" }).click();
    expect(posts).toBe(0);
  });

  // The Running page follows the job from there, scrolled to the job's own row.
  test("an accepted post goes to the Running page scrolled to the job's shut row", async () => {
    const page = await open(ACCEPTED);
    await close(page).click();
    await dialog(page).locator("textarea").fill("It will not work.");
    await dialog(page).getByRole("button", { name: "OK" }).click();
    await page.waitForURL((url) => url.pathname === "/");
    expect(new URL(page.url()).hash).toBe(`#spec-aide/${LIVE}:close@j1`);
  });

  test("Cancel closes the box on every press", async () => {
    const page = await open(ACCEPTED);
    for (let i = 0; i < 2; i++) {
      await close(page).click();
      await dialog(page).waitFor({ state: "visible" });
      await dialog(page).getByRole("button", { name: "Cancel" }).click();
      await dialog(page).waitFor({ state: "hidden" });
    }
  });
});
