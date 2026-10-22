// The count of waiting specs reaches the app's icon when a page loads. Only a
// browser has `navigator.setAppBadge`, so a recording one stands in for it
// before the page is drawn.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-app-badge-");
let browser: Browser;
let base: string;

const failedJob = {
  id: "f1", project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"], stepIndex: 0, state: "failed",
  timeoutSec: { implement: 60 }, permissionMode: { implement: "acceptEdits" }, model: { implement: "sonnet" },
  createdAt: "2026-09-01T10:00:00.000Z", results: [], spentUsd: 0,
};

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  base = harness.start({ queueMirror: JSON.stringify([failedJob]) }).base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

describe("a page sets the app's icon count when it loads", () => {
  test("one failed spec in a served project makes setAppBadge(1) on the Running tab (AC-3)", async () => {
    const page = await browser.newPage();
    try {
      await page.addInitScript(() => {
        const calls: string[] = [];
        (window as unknown as { __badge: string[] }).__badge = calls;
        Object.defineProperty(navigator, "setAppBadge", { value: (n: number) => (calls.push(`set ${n}`), Promise.resolve()) });
        Object.defineProperty(navigator, "clearAppBadge", { value: () => (calls.push("clear"), Promise.resolve()) });
      });
      await withBrowser(page.goto(`${base}/?live=0`), "page.goto(Running)");
      expect(await page.evaluate(() => (window as unknown as { __badge: string[] }).__badge)).toEqual(["set 1"]);
    } finally {
      await page.close();
    }
  });
});
