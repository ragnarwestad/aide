// The Config tab's two settings cards in a browser: a refused Save keeps
// what was typed and says why in its own card, and one card's Cancel puts
// only that card's fields back. Only a browser runs the page script that
// posts, and the form reset that Cancel is.
//
// By hand: `cd dashboard && bun test --timeout 20000 test/e2e/project-page/config-cards.test.ts`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { harness, ownDirs, projectsRoot, settled, serve } from "../../project/detail/project-detail-route-fixtures.ts";

browserDeadline();

let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  const root = projectsRoot({ aide: "AIDE_SPECS_PATH=/srv/specs\n" });
  base = serve(root, settled(root, "aide"));
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const configCard = () => page.locator('form.projectsettingsform:has([name="specsPath"])');
const manifestCard = () => page.locator('form.projectsettingsform:has([name="testCmd"])');

test("a refused Save shows the route's sentence in its own card and keeps the typed value (AC-7)", async () => {
  await withBrowser(page.goto(`${base}/projects/aide?tab=config`), "page.goto");
  const field = configCard().locator('[name="specsPath"]');
  await field.fill("relative/specs");
  await configCard().getByRole("button", { name: "Save" }).click();
  await configCard().locator(".refused", { hasText: "full path" }).waitFor();
  expect(await field.inputValue()).toBe("relative/specs");
  expect(new URL(page.url()).searchParams.get("tab")).toBe("config");
});

test("one card's Cancel puts its own fields back and leaves the other card's edit (AC-8)", async () => {
  await withBrowser(page.goto(`${base}/projects/aide?tab=config`), "page.goto");
  await configCard().locator('[name="specsPath"]').fill("/elsewhere");
  await manifestCard().locator('[name="testCmd"]').fill("bun test");
  await configCard().getByRole("button", { name: "Cancel" }).click();
  expect(await configCard().locator('[name="specsPath"]').inputValue()).toBe("/srv/specs");
  expect(await manifestCard().locator('[name="testCmd"]').inputValue()).toBe("bun test");
});
