// An acceptance criterion's Not yet box in a real browser: what a real click
// and Save on the Status tab store.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../helpers/queue-server.ts";
import { recording } from "../spec-page/spec-checks-fixtures.ts";

browserDeadline();
const LIVE = "81-queue-and-runner";
const LONG = `AC-2: ${"a criterion that keeps going and going ".repeat(5)}`.trim();
const LIVE_ONE = "| AC-1: it folds | ✅ | |";
const LIVE_TWO = `| ${LONG} | ⬜ | a note under the criterion |`;
const LIVE_STATUS = [
  "# Queue - Status", "", "## Tracking info", "",
  "- **Workflow steps completed:** analyze, implement", "",
  "## Acceptance criteria", "",
  "| Task | Status | Notes |", "|------|--------|-------|",
  LIVE_ONE, LIVE_TWO, "",
].join("\n");
const LIVE_STATE = JSON.stringify({
  completedPhases: ["analyze", "implement"], archived: null, reopened: null, phaseCounts: {},
  acceptanceCriteria: [{ task: "AC-1: it folds", done: true }, { task: LONG, done: false }],
});

const harness = queueHarness("aide-e2e-check-columns-");
let browser: Browser;
let page: Page;
let base: string;
let dir: string;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  const started = harness.start({
    extra: { gitRun: recording().run },
    status: LIVE_STATUS,
  });
  base = started.base;
  dir = started.dir;
  writeFileSync(join(dir, "root", "aide", "specs", LIVE, "4-status.json"), LIVE_STATE);
  ran(dir, ["analyze", "implement"]);
  // The live spec's criteria are drawn only once its freshness check has
  // verified "implement" against git history, which the list reaches by its
  // own poll.
  const deadline = Date.now() + 10_000;
  while (!(await (await fetch(`${base}/specs?live=0`)).text()).includes("Tick the ACs in the panel below")) {
    if (Date.now() > deadline) throw new Error("the specs list never carried the acceptance hold-back message");
    await new Promise((r) => setTimeout(r, 50));
  }
});
afterAll(async () => { await browser.close(); harness.cleanup(); });

describe("the boxes save as they did", () => {
  test("on the Status tab, ticking Not yet on a done row and pressing Save stores it as Not verified", async () => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(`${base}/specs/aide/${LIVE}?tab=status&live=0`);
    await page.waitForSelector("section.checks .check");
    await page.locator(`input[name="unverified"][value="${LIVE_ONE}"]`).check();
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      page.locator("form.specform button[type=\"submit\"]").click(),
    ]);
    const file = readFileSync(join(dir, "root", "aide", "specs", LIVE, "4-status.md"), "utf-8");
    expect(file).toContain("| AC-1: it folds | Not verified |");
  });
});
