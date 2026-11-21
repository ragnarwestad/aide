// The Projects list in a browser: a press anywhere on a project's row, its
// description included, opens that project's page. Only a browser decides
// what a press on the row lands on.
//
// By hand: `cd dashboard && bun test --timeout 20000 test/e2e/project-page/projects-list-rows.test.ts`.
import { afterAll, beforeAll, test } from "bun:test";
import { rmSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { harness, ownDirs, projectsRoot, settled, serve } from "../../project/detail/project-detail-route-fixtures.ts";

browserDeadline();

let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  const root = projectsRoot({ aide: "" });
  base = serve(root, settled(root, "aide"));
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

test("a press on a row's description opens that project's page (AC-2)", async () => {
  const page = await browser.newPage();
  await withBrowser(page.goto(`${base}/projects`), "page.goto");
  // A press where the description is drawn, as a reader's pointer lands:
  // the row's link lies over the text, so a click aimed at the text element
  // itself is refused by Playwright as intercepted.
  const box = (await page.locator('[data-project="aide"]').getByText("the aide project").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForURL((url) => url.pathname === "/projects/aide");
  await page.close();
});
