// The `N not verified · M failed` info line on a spec's row, in a real
// browser. The unit tests prove the markup; whether the line stays inside
// its row at phone width, with the list not scrolling sideways, is a
// question only a browser answers.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../../helpers/queue-server.ts";
import { recording } from "../../spec-page/spec-checks-fixtures.ts";

browserDeadline();
const FOLDER = "81-queue-and-runner";
const STATUS = [
  "# Queue - Status", "",
  "## Tracking info", "",
  "- **Workflow steps completed:** analyze, implement", "",
  "## Acceptance criteria", "",
  "| Task | Status | Notes |", "|------|--------|-------|",
  "| AC-1: it deploys | Not verified | Not tested: needs production |",
  "| AC-2: it retries | ❌ Failed | Failed: the log shows no row |", "",
].join("\n");
const STATE_JSON = JSON.stringify({
  completedPhases: ["analyze", "implement"], archived: null, reopened: null,
  acceptanceCriteria: [
    { task: "AC-1: it deploys", done: true, notVerified: true },
    { task: "AC-2: it retries", done: false, failed: true },
  ],
  phaseCounts: {},
});

const harness = queueHarness("aide-e2e-verification-mark-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  // The state goes in through the harness, not written afterwards: the
  // server reads a spec once and caches it, so a 4-status.json that lands
  // after `start()` is never seen — the row then has no counts, and the
  // mark this test is about is correctly not drawn.
  const started = harness.start({ extra: { gitRun: recording().run }, status: STATUS, liveState: STATE_JSON });
  base = started.base;
  ran(started.dir, ["analyze", "implement"]);
});

afterAll(async () => { await browser.close(); harness.cleanup(); });

describe("the verification line at phone width", () => {
  test("it reads both numbers and stays inside its row", async () => {
    await page.goto(`${base}/?live=0&state=all`);
    const line = page.locator(`tr.specnotice[data-folder="${FOLDER}"]`, { hasText: "not verified" });
    await line.waitFor();
    expect(await line.innerText()).toContain("1 not verified · 1 failed");
    const box = (await line.boundingBox())!;
    const head = (await page.locator(`tr.spechead[data-folder="${FOLDER}"]`).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(head.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(head.x + head.width + 1);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(sideways).toBeLessThanOrEqual(0);
  });
});
