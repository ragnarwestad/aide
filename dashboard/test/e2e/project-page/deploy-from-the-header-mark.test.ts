// The header's Deploy mark opens the same question as the Deploy tab, and
// OK queues a job and opens its row on the Running tab.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import type { GitRunner } from "../../../src/git/process/index.ts";
import { setDeployWaiting } from "../../../src/render/ui/deploy-mark/index.ts";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import {
  INSTALLS, behindBy, harness, ownDirs, projectsRoot,
} from "../../project/detail/project-detail-route-fixtures.ts";

browserDeadline();

let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await chromium.launch();
  const root = projectsRoot({ aide: INSTALLS });
  const results = mkdtempSync(join(tmpdir(), "aide-deploy-mark-job-"));
  ownDirs.push(results);
  const inner = behindBy(root, "aide", 1);
  const run: GitRunner = async (dir, args) =>
    args[0] === "merge" ? new Promise<never>(() => {}) : inner.run(dir, args);
  base = harness.start({
    extra: {
      projectRoot: root,
      queueProjectRoot: root,
      gitRun: run,
      driftPollMs: 600_000,
      dashboardRoot: join(root, "aide"),
      queueRunnerBin: "/usr/bin/true",
      queueResultDir: results,
      restart: { registered: async () => false, fire: () => {} },
    },
  }).base;
  setDeployWaiting(() => ({ project: "aide", commits: 1, branch: "main" }));
});

afterAll(async () => {
  setDeployWaiting(undefined);
  await browser.close();
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

describe("Deploy from the header mark", () => {
  test("opens the shared question and OK queues the job (AC-1, AC-2)", async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/specs?live=0`);
    await page.locator("header button.deploymark").click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByText("Deploy aide?").waitFor({ state: "visible" });
    await dialog.getByRole("button", { name: "OK" }).click();
    await page.waitForURL((u) => u.pathname === "/" && u.hash.startsWith("#spec-aide/deploy:deploy@"), { timeout: 10_000 });
    const row = page.locator('tr[id^="spec-aide/deploy:deploy@"]');
    await row.waitFor({ state: "visible", timeout: 5000 });
    await row.locator('a[data-fold="open"]').click();
    await page.locator("tr.subrow[data-step]").first().waitFor({ state: "visible", timeout: 5000 });
    expect(await page.locator("tr.subrow[data-step]").count()).toBe(5);
    setDeployWaiting(() => ({ project: "aide", commits: 1, branch: "main", underWay: "running" }));
    await page.goto(`${base}/specs?live=0`);
    const mark = page.locator("header button.deploymark");
    expect(await mark.isDisabled()).toBe(true);
    await mark.evaluate((button: HTMLButtonElement) => button.click());
    expect(await page.locator("dialog[open]").count()).toBe(0);
    await page.close();
  });
});
