// The Deploy dialog keeps one box from the press to the end (AC-1): the
// same width and height at the press, while each step runs and is done,
// and after a failure with a long error. Only a browser can measure it.
// The four step requests and the version probe are answered by the test,
// so nothing is installed and no service is restarted.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browserDeadline, withBrowser } from "../helpers/browser-deadline.ts";
import { fakeGit } from "../helpers/fake-git.ts";
import { queueHarness } from "../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-deploy-size-");
let browser: Browser;
let page: Page;
let base: string;

/** Two commits behind origin on the default branch: the state in which
 *  the Deploy button is live. */
const behind = fakeGit({
  "symbolic-ref": { code: 0, stdout: "refs/remotes/origin/main\n" },
  "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
  "rev-list --count": { code: 0, stdout: "2\n" },
});

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  const started = harness.start({ extra: { gitRun: behind.run, driftPollMs: 40 } });
  base = started.base;
  const project = join(started.dir, "root", "aide");
  mkdirSync(join(project, ".aide"), { recursive: true });
  writeFileSync(join(project, ".aide", "config"), "AIDE_INSTALL_CMD=/usr/bin/true\n");
  // The button is live only once the background poll has counted origin.
  const deadline = Date.now() + 10_000;
  for (;;) {
    const html = await (await fetch(`${base}/projects/aide?tab=deploy`)).text();
    if (/<form[^>]*class="deployform"[\s\S]*?<button type="submit" class="btn primary"(?![^>]*disabled)/.test(html)) break;
    if (Date.now() > deadline) throw new Error("the Deploy button never went live");
    await new Promise((r) => setTimeout(r, 50));
  }
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

const dialog = () => page.locator("dialog[data-deploy-dialog]");
const size = async (): Promise<{ width: number; height: number }> => {
  const box = await dialog().boundingBox();
  expect(box).not.toBeNull();
  return { width: box!.width, height: box!.height };
};

/** Answers the step requests after a beat, so a step is `running` long
 *  enough to be measured; `fail` names the step that answers 400. */
async function stub(fail?: string): Promise<void> {
  await page.route("**/api/queue/projects/aide/deploy/*", async (route) => {
    const step = route.request().url().split("/").pop()!;
    await new Promise((r) => setTimeout(r, 500));
    if (step === fail) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "the install command failed — ".repeat(30) }),
      });
      return;
    }
    const body = step === "restart" ? { ok: true, restart: "fired", startedAt: "old" } : { ok: true };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/api/version", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ sha: "abc", startedAt: "new" }) }),
  );
}

describe("the Deploy dialog's size", () => {
  test("is the same at the press, at every step and when it is done (AC-1)", async () => {
    await stub();
    await withBrowser(page.goto(`${base}/projects/aide?tab=deploy&live=0`), "page.goto(deploy)");
    await page.locator("form.deployform button.btn.primary").click();
    await dialog().waitFor({ state: "visible" });
    const atPress = await size();
    for (const step of ["fetch", "install", "restart", "wait", "check"]) {
      // Left `waiting`: running or already done, so a step that flashes by
      // between two polls is still measured.
      await page.waitForSelector(`[data-step="${step}"]:not([data-state="waiting"])`, { timeout: 15_000 });
      expect(await size()).toEqual(atPress);
    }
    await page.waitForSelector(".deploymessage:not(:empty)", { timeout: 15_000 });
    expect(await size()).toEqual(atPress);
  });

  test("is the same after a failure with a long error, with Close showing (AC-1)", async () => {
    await page.unroute("**/api/queue/projects/aide/deploy/*");
    await stub("install");
    await withBrowser(page.goto(`${base}/projects/aide?tab=deploy&live=0`), "page.goto(deploy)");
    await page.locator("form.deployform button.btn.primary").click();
    await dialog().waitFor({ state: "visible" });
    const atPress = await size();
    await page.waitForSelector('[data-step="install"][data-state="failed"]', { timeout: 15_000 });
    expect(await page.locator("[data-deploy-close]").isVisible()).toBe(true);
    expect(await size()).toEqual(atPress);
  });
});
