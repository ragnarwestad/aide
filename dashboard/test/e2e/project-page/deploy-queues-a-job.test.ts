// The board's own Deploy asks first, and OK queues a job and goes to the
// Running tab with the job's row open. Only a browser presses the button,
// clicks OK in the dialog and follows the page to the Running tab.
//
// The fetch is held, so the job is still in flight when the page lands: a
// finished deploy has no row.
//
// By hand: `cd dashboard && bun test --timeout 20000 test/e2e/project-page/deploy-queues-a-job.test.ts`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import type { GitRunner } from "../../../src/git/branch-status.ts";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import {
  INSTALLS, behindBy, harness, loadUntil, ownDirs, projectsRoot,
} from "../../project/detail/project-detail-route-fixtures.ts";

browserDeadline();

let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await chromium.launch();
  const root = projectsRoot({ aide: INSTALLS });
  const results = mkdtempSync(join(tmpdir(), "aide-deploy-job-"));
  ownDirs.push(results);
  const inner = behindBy(root, "aide", 1);
  // The fast-forward never answers: the deploy stays at its first step.
  const run: GitRunner = async (dir, args) =>
    args[0] === "merge" ? new Promise<never>(() => {}) : inner.run(dir, args);
  base = harness.start({
    extra: {
      projectRoot: root,
      queueProjectRoot: root,
      gitRun: run,
      driftPollMs: 600_000,
      // This project is the checkout the board runs from, so its Deploy is a job.
      dashboardRoot: join(root, "aide"),
      queueRunnerBin: "/usr/bin/true",
      queueResultDir: results,
      restart: { registered: async () => false, fire: () => {} },
    },
  }).base;
  await loadUntil(base, "aide", "commit behind origin", 5000, "deploy");
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

describe("Deploy on the board's own project page", () => {
  test("OK queues the job and the page lands on the Running tab with the job's row open", async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/projects/aide?tab=deploy&live=0`);
    await page.getByRole("button", { name: "Deploy", exact: true }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "OK" }).click();
    await page.waitForURL((u) => u.pathname === "/" && u.searchParams.get("open") === "aide/deploy:deploy", { timeout: 10_000 });
    const row = page.locator('tr[id="spec-aide/deploy:deploy"]');
    await row.waitFor({ state: "visible", timeout: 5000 });
    await page.locator('tr.subrow[data-step="Step 1 of 5"]').waitFor({ state: "visible", timeout: 5000 });
    expect(await page.locator("tr.subrow[data-step]").count()).toBe(5);
    await page.close();
  });
});
