// OK in Cancel's, Delete's and Remove project's dialogs does what the old
// copy did: exactly one POST, to the route it always went to.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import { queueHarness } from "../helpers/queue-server.ts";

browserDeadline();

const FOLDER = "81-queue-and-runner";
const harness = queueHarness("aide-e2e-confirm-ok-");
let browser: Browser;

/** A board with a running job and a schedule entry, each test on its own:
 *  Remove project takes `aide` off the allowlist. */
function board(): string {
  const scratch = mkdtempSync(join(tmpdir(), "aide-e2e-confirm-ok-"));
  writeFileSync(
    join(scratch, "queue.json"),
    JSON.stringify([
      {
        id: "run1", project: "aide", specFolder: FOLDER, steps: ["analyze"], stepIndex: 0, state: "running",
        timeoutSec: {}, permissionMode: {}, model: {}, createdAt: "2026-09-18T03:00:00Z", startedAt: "2026-09-18T03:00:00Z",
      },
    ]),
  );
  const queueConfigFile = join(scratch, "queue-config.json");
  writeFileSync(
    queueConfigFile,
    JSON.stringify({ schedules: { aide: [{ name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md" }] } }),
  );
  return harness.start({ extra: { queueMirrorPath: join(scratch, "queue.json"), queueConfigFile } }).base;
}

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

/** Presses the button naming `id`, then OK in its dialog; answers every
 *  queue POST with `fulfil` when given, and hands back every POST's path. */
async function pressOk(page: Page, url: string, id: string, fulfil?: unknown): Promise<string[]> {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(new URL(r.url()).pathname);
  });
  if (fulfil) {
    await page.route(
      (u) => u.pathname.startsWith("/api/queue"),
      (route) => (route.request().method() === "POST" ? route.fulfill({ json: fulfil }) : route.continue()),
    );
  }
  await page.goto(url);
  await page.locator(`button[data-ask="${id}"]`).click();
  const box = page.locator(`dialog[id="${id}"]`);
  await box.waitFor({ state: "visible" });
  await box.getByRole("button", { name: "OK" }).click();
  return posts;
}

describe("OK posts once, to the old route", () => {
  test("Cancel on a list row (AC-4)", async () => {
    const base = board();
    const page = await browser.newPage();
    const posts = await pressOk(page, `${base}/specs?live=0&open=aide%2F${FOLDER}`, "cancelask-run1", { ok: true });
    await page.waitForTimeout(500);
    expect(posts).toEqual(["/api/queue/run1/cancel"]);
    await page.close();
  });

  test("Delete on a schedule row (AC-4)", async () => {
    const base = board();
    const page = await browser.newPage();
    const posts = await pressOk(page, `${base}/projects/aide?tab=schedule&live=0`, "deleteask-aide/nightly-report");
    await page.waitForLoadState("load");
    await page.waitForTimeout(300);
    expect(posts).toEqual(["/api/queue/schedule/aide/nightly-report/delete"]);
    await page.close();
  });

  test("Remove project lands on the list, with the project off the allowlist (AC-3, AC-4)", async () => {
    const base = board();
    const page = await browser.newPage();
    const posts = await pressOk(page, `${base}/projects/aide?tab=config&live=0`, "removeask");
    await page.waitForURL((u) => new URL(u).pathname === "/projects");
    expect(posts).toEqual(["/api/queue/projects/aide/remove"]);
    // Its checkout stays on disk, so the list may still show it as found
    // there; what is gone is the allowlist entry Remove took away.
    const config = await (await fetch(`${base}/projects/aide?tab=config`)).text();
    expect(config).not.toContain('data-ask="removeask"');
    await page.close();
  });
});
