// The Deploy tab asks origin the moment it is opened and shows the answer
// in place: a push to main after the server last asked is reported without
// waiting for the timer and without a reload. Only a browser runs the page
// script that asks and redraws.
//
// By hand: `cd dashboard && bun test --timeout 20000 test/e2e/project-page/deploy-checks-origin-on-open.test.ts`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import type { GitRunner } from "../../../src/git/branch-status.ts";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import {
  INSTALLS, behindBy, harness, loadUntil, ownDirs, projectsRoot, serve,
} from "../../project/detail/project-detail-route-fixtures.ts";

browserDeadline();

let browser: Browser;
let base: string;
/** How many commits origin is ahead, as the checkout's git answers. */
let ahead = 0;

beforeAll(async () => {
  browser = await chromium.launch();
  const root = projectsRoot({ aide: INSTALLS });
  const inner = behindBy(root, "aide", 0);
  const run: GitRunner = async (dir, args) =>
    args[0] === "rev-list" ? { code: 0, stdout: `${ahead}\n` } : inner.run(dir, args);
  // The timer is long enough never to tick again: only the boot's own check
  // and the one the tab makes can have asked.
  base = serve(root, { run }, 600_000);
  await loadUntil(base, "aide", "This checkout matches origin", 5000, "deploy");
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

describe("opening the Deploy tab asks origin", () => {
  test("a commit pushed since the last answer turns the sentence and the button in place, with one document load (AC-2)", async () => {
    ahead = 1;
    const page = await browser.newPage();
    let documents = 0;
    page.on("request", (req) => {
      if (req.resourceType() === "document") documents += 1;
    });
    await page.goto(`${base}/projects/aide?tab=deploy&live=0`);
    await page.getByText("1 commit behind origin").waitFor({ state: "visible", timeout: 5000 });
    expect(await page.locator("form.deployform").getByRole("button", { name: "Deploy" }).isEnabled()).toBe(true);
    expect(documents).toBe(1);
    await page.close();
  });
});
