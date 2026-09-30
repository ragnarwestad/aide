// Remove project and Deploy each stand in their progress dialog while their
// request is out: the running word shows, the question does not, and neither
// Escape nor a click outside closes it. Only a browser draws the faces and
// answers Escape.
//
// By hand: `cd dashboard && bun test --timeout 20000 test/e2e/progress-dialog-holds.test.ts`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import {
  INSTALLS, behindBy, harness, loadUntil, ownDirs, projectsRoot, serve,
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
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

/** The project page on `tab`, with every POST whose path ends in `held` left
 *  unanswered. */
async function open(tab: string, held: string): Promise<Page> {
  const page = await browser.newPage();
  await page.route(
    (u) => u.pathname.endsWith(held),
    (route) => (route.request().method() === "POST" ? new Promise<void>(() => {}) : route.continue()),
  );
  await page.goto(`${base}/projects/aide?tab=${tab}&live=0`);
  return page;
}

const modal = (box: Locator): Promise<boolean> => box.evaluate((el) => (el as HTMLDialogElement).matches(":modal"));

/** Escape twice and a click in the page's corner, outside the dialog. */
async function tryToClose(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.mouse.click(4, 4);
  await page.waitForTimeout(400);
}

describe("a running step stands in its progress dialog", () => {
  test("Remove project shows Removing… and not its question while its request is out, through Escape and a click outside (AC-1, AC-2)", async () => {
    const page = await open("config", "/remove");
    await page.locator('button[data-ask="removeask"]').click();
    const box = page.locator("dialog#removeask");
    await box.getByRole("button", { name: "OK" }).click();
    await box.getByRole("heading", { name: "Removing…" }).waitFor({ state: "visible", timeout: 5000 });
    expect(await box.getByText("takes it off the allowlist").isVisible()).toBe(false);
    expect(await box.getByRole("button", { name: "Cancel" }).isVisible()).toBe(false);
    await tryToClose(page);
    expect(await box.isVisible()).toBe(true);
    expect(await modal(box)).toBe(true);
    await page.close();
  });

  test("Deploy shows Deploying… and its five steps while a step runs, through Escape and a click outside (AC-1, AC-2)", async () => {
    const page = await open("deploy", "/deploy/fetch");
    await page.locator("form.deployform").getByRole("button", { name: "Deploy" }).click();
    const box = page.locator("dialog[data-deploy-dialog]");
    await box.getByRole("heading", { name: "Deploying…" }).waitFor({ state: "visible", timeout: 5000 });
    const steps = box.locator("li[data-step]");
    expect(await steps.count()).toBe(5);
    for (let i = 0; i < 5; i++) expect(await steps.nth(i).isVisible()).toBe(true);
    await tryToClose(page);
    expect(await box.isVisible()).toBe(true);
    expect(await modal(box)).toBe(true);
    await page.close();
  });
});
