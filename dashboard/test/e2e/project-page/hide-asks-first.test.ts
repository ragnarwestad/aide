// Hide on the Config tab, in a browser: only a browser opens the dialog the
// button names and posts its OK, so only here does Cancel leave the project
// shown and OK hide it.
//
// By hand: `cd dashboard && bun test test/e2e/project-page/hide-asks-first.test.ts`.
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
  const root = projectsRoot({ aide: null });
  base = serve(root, settled(root, "aide"));
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

test("Hide asks first: Cancel leaves the project shown, OK hides it and offers Show (AC-2)", async () => {
  await withBrowser(page.goto(`${base}/projects/aide?tab=config`), "page.goto");
  const hide = page.getByRole("button", { name: "Hide", exact: true });
  await hide.click();
  const dialog = page.locator("dialog[open]");
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "detached" }).catch(() => undefined);
  expect(await page.locator("dialog[open]").count()).toBe(0);
  await withBrowser(page.reload(), "page.reload");
  expect(await page.getByRole("button", { name: "Hide", exact: true }).count()).toBe(1);

  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "OK" }).click();
  await page.getByRole("button", { name: "Show", exact: true }).waitFor();
  expect(await page.getByRole("button", { name: "Hide", exact: true }).count()).toBe(0);
});
