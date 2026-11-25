// The board's own Deploy asks first, and OK queues a job and goes to the
// Running tab at the job's row, shut. Only a browser presses the button,
// clicks OK in the dialog and follows the page to the Running tab.
//
// The fetch is held, so the job is still in flight when the page lands: a
// finished deploy has no row.
//
// By hand: `cd dashboard && bun test --timeout 20000 test/e2e/project-page/deploy-queues-a-job.test.ts`.
import { describe, expect, test } from "bun:test";
import type { Browser } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { e2eBrowser } from "../../helpers/setup/e2e-browser.ts";
import { heldDeployBoard, loadUntil, routeBoard } from "../../project/detail/project-detail-route-fixtures.ts";

browserDeadline();

let browser: Browser;
let base: string;

e2eBrowser(routeBoard, async (launched) => {
  browser = launched;
  base = heldDeployBoard("aide-deploy-job-");
  await loadUntil(base, "aide", "commit behind origin", 5000, "deploy");
});

describe("Deploy on the board's own project page", () => {
  test("OK queues the job and the page lands on the Running tab at the job's row, which opens on its five steps", async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/projects/aide?tab=deploy&live=0`);
    await page.getByRole("button", { name: "Deploy", exact: true }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "OK" }).click();
    await page.waitForURL((u) => u.pathname === "/" && u.hash.startsWith("#spec-aide/deploy:deploy@"), { timeout: 10_000 });
    const row = page.locator('tr[id^="spec-aide/deploy:deploy@"]');
    await row.waitFor({ state: "visible", timeout: 5000 });
    await row.locator('a[data-fold="open"]').click();
    await page.locator('tr.subrow[data-step="Step 1 of 5"]').waitFor({ state: "visible", timeout: 5000 });
    expect(await page.locator("tr.subrow[data-step]").count()).toBe(5);
    await page.goto(`${base}/projects/aide?tab=deploy&live=0`);
    expect(await page.getByRole("button", { name: "Deploy", exact: true }).isDisabled()).toBe(true);
    await page.close();
  });
});
