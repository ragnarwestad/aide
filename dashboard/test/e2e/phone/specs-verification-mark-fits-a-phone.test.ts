// Spec 510, AC-5: the `N not verified · M failed` mark under a spec's name on
// the specs list, in a real browser. The unit tests prove the markup; whether
// the mark sits under the project line and stays inside its row at phone width
// is a question only a browser answers.
//
// Not run by this round: Aide is not a project where the session runs the
// e2e suite. Run it with
// `cd dashboard && bun test --timeout 20000 test/e2e/specs-verification-mark-fits-a-phone.test.ts`.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { queueHarness, ran } from "../../helpers/queue-server.ts";
import { recording } from "../../spec-page/spec-checks-fixtures.ts";

setDefaultTimeout(20_000);
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

describe("the verification mark at phone width", () => {
  test("it reads both numbers, sits under the name and stays inside its row", async () => {
    await page.goto(`${base}/?live=0&state=all`);
    const mark = page.locator(`tr.spechead[data-folder="${FOLDER}"] .spec-notverified`);
    await mark.waitFor();
    expect(await mark.innerText()).toContain("1 not verified · 1 failed");
    const box = (await mark.boundingBox())!;
    // `.label`, not `.spec-name`: the wrapper is `display: contents` at
    // phone width (narrow.css), so it draws no box at all and has no
    // position to be under. The line that draws `aide: 81-…` does.
    const name = (await page.locator(`tr.spechead[data-folder="${FOLDER}"] .label`).boundingBox())!;
    const row = (await page.locator(`tr.spechead[data-folder="${FOLDER}"]`).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
    expect(box.x).toBeGreaterThanOrEqual(row.x);
    expect(box.x + box.width).toBeLessThanOrEqual(row.x + row.width + 1);
  });
});
