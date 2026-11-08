// Remove project, once its OK is pressed: the question closes and the
// loading cover shows Removing… while the request is out, and neither
// Escape nor a click outside lifts it. Only a browser draws the cover and
// answers Escape.
//
// By hand: `cd dashboard && bun test --timeout 20000 test/e2e/progress-dialog-holds.test.ts`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import {
  INSTALLS,
  behindBy,
  harness,
  loadUntil,
  ownDirs,
  projectsRoot,
  serve,
} from "../project/detail/project-detail-route-fixtures.ts";

browserDeadline();

let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await chromium.launch();
  const root = projectsRoot({ aide: INSTALLS });
  base = serve(root, behindBy(root, "aide", 1), 25);
  await loadUntil(base, "aide", "commit behind origin", 5000, "deploy");
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
  while (ownDirs.length)
    rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

/** Escape twice and a click in the page's corner, outside the cover. */
async function tryToClose(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.mouse.click(4, 4);
  await page.waitForTimeout(400);
}

describe("a press that asks first covers the page while it is sent", () => {
  test("Remove project shows Removing… in the loading cover, not its question, through Escape and a click outside", async () => {
    const page = await browser.newPage();
    await page.route(
      (u) => u.pathname.endsWith("/remove"),
      (route) =>
        route.request().method() === "POST"
          ? new Promise<void>(() => {})
          : route.continue(),
    );
    await page.goto(`${base}/projects?live=0`);
    await page.locator('button[data-ask="removeask-aide"]').click();
    const ask = page.locator('dialog[id="removeask-aide"]');
    await ask.getByRole("button", { name: "OK" }).click();
    const cover = page.locator("dialog.pageoverlay");
    await cover
      .getByText("Removing…")
      .waitFor({ state: "visible", timeout: 5000 });
    expect(await ask.isVisible()).toBe(false);
    await tryToClose(page);
    expect(await cover.isVisible()).toBe(true);
    await page.close();
  });
});
