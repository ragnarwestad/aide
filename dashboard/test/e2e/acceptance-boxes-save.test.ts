// An acceptance criterion's two boxes in a real browser: what a real click
// clears and saves, and the archived note's length bound, are questions only a
// browser answers.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../helpers/queue-server.ts";
import { phaseSection, PHASE, recording } from "../spec-page/spec-checks-fixtures.ts";

browserDeadline();
const LIVE = "81-queue-and-runner";
const ARCHIVED = "150-the-archived-one";
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
const DONE = "| AC-1: it was ticked | ✅ | |";
const NV = `| ${LONG} | Not verified | Not tested: needs production |`;
const FAILED = "| AC-3: it failed | ❌ Failed | Failed: it did not hold |";
const ARCHIVED_STATUS = [
  "# Queue - Status", "", "## Tracking info", "",
  "- **Workflow steps completed:** create, analyze, implement, archive", "- **Archived:** `2026-09-01`", "",
  phaseSection(PHASE, [DONE, NV, FAILED]),
].join("\n");
const ARCHIVED_STATE = JSON.stringify({
  completedPhases: ["create", "analyze", "implement", "archive"], archived: "2026-09-01", reopened: null, phaseCounts: {},
  acceptanceCriteria: [
    { task: "AC-1: it was ticked", done: true },
    { task: LONG, done: true, notVerified: true },
    { task: "AC-3: it failed", done: false, failed: true },
  ],
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
    archivedSpecs: { [ARCHIVED]: { status: ARCHIVED_STATUS, state: ARCHIVED_STATE } },
  });
  base = started.base;
  dir = started.dir;
  writeFileSync(join(dir, "root", "aide", "specs", LIVE, "4-status.json"), LIVE_STATE);
  ran(dir, ["analyze", "implement"]);
  // The list draws the live spec's criteria only once its freshness check has
  // verified "implement" against git history, which the list reaches by its
  // own poll.
  const deadline = Date.now() + 10_000;
  while (!(await (await fetch(`${base}/specs?live=0`)).text()).includes("tick them under › on the Specs list, or on the Status tab")) {
    if (Date.now() > deadline) throw new Error("the specs list never carried the acceptance hold-back message");
    await new Promise((r) => setTimeout(r, 50));
  }
});
afterAll(async () => { await browser.close(); harness.cleanup(); });

async function status(folder: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${base}/specs/aide/${folder}?tab=status&live=0`);
  await page.waitForSelector("section.checks .check");
}
async function unfolded(folder: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${base}/specs?live=0&checks=aide%2F${folder}`);
  await page.waitForSelector(`tr.specnotice[data-folder="${folder}"] .rowchecks .check`);
}

describe("the boxes save as they did, and one clears the other (AC-3)", () => {
  test("on the Specs list, ticking Not yet clears Yes, and ticking Yes over it clears Not yet", async () => {
    await unfolded(LIVE, 1100);
    const yes = page.locator(`.rowchecks input[name="tick"][value="${LIVE_ONE}"]`);
    const notYet = page.locator(`.rowchecks input[name="unverified"][value="${LIVE_ONE}"]`);
    expect(await yes.isChecked()).toBe(true);
    await notYet.check();
    expect(await yes.isChecked()).toBe(false);
    await yes.check();
    expect(await notYet.isChecked()).toBe(false);
  });

  test("on the Status tab, ticking Not yet on a done row and pressing Save stores it as Not verified", async () => {
    await status(LIVE, 1100);
    await page.locator(`input[name="unverified"][value="${LIVE_ONE}"]`).check();
    await Promise.all([page.waitForEvent("load"), page.locator("form.specform button[type=\"submit\"]").click()]);
    const file = readFileSync(join(dir, "root", "aide", "specs", LIVE, "4-status.md"), "utf-8");
    expect(file).toContain("| AC-1: it folds | Not verified |");
  });
});

describe("the archived note is bounded at 500 (AC-4)", () => {
  test("600 typed characters stop at 500 and the count says so", async () => {
    await unfolded(ARCHIVED, 1100);
    await page.locator(`.rowchecks input[name="failed"]`).check();
    const field = page.locator(".rowchecks .failnote");
    await field.click();
    await page.keyboard.type("a".repeat(600), { delay: 0 });
    expect((await field.inputValue()).length).toBe(500);
    expect(await field.evaluate((el) => el.nextElementSibling!.textContent)).toBe("500 of 500 characters, 0 left");
  });
});
