// The acceptance criteria unfolded on the specs list, in a real browser:
// whether the › works as a link, and whether the boxes outside the form
// post through `form=` and clear the hold once the last one is ticked.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { queueHarness, ran } from "../../helpers/queue-server.ts";
import { recording } from "../../spec-page/spec-checks-fixtures.ts";

browserDeadline();
const FOLDER = "81-queue-and-runner";
const LONG = `AC-2: ${"a criterion that keeps going and going ".repeat(5)}`.trim();
const ROW_ONE = "| AC-1: it folds | ⬜ | |";
const ROW_TWO = `| ${LONG} | ⬜ | a note under the criterion |`;
const STATUS = [
  "# Queue - Status", "",
  "## Tracking info", "",
  "- **Workflow steps completed:** analyze, implement", "",
  "## Acceptance criteria", "",
  "| Task | Status | Notes |", "|------|--------|-------|",
  ROW_ONE, ROW_TWO, "",
].join("\n");
const STATE_JSON = JSON.stringify({
  completedPhases: ["analyze", "implement"], archived: null, reopened: null,
  acceptanceCriteria: [{ task: "AC-1: it folds", done: false }, { task: LONG, done: false }], phaseCounts: {},
});

const harness = queueHarness("aide-e2e-acceptance-fold-");
let browser: Browser;
let page: Page;
let base: string;

async function waitUntil(cond: () => Promise<boolean>, ms: number, label: string): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await cond()) return;
    if (Date.now() >= deadline) throw new Error(`${label} did not happen within ${ms}ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  const started = harness.start({ extra: { gitRun: recording().run }, status: STATUS });
  base = started.base;
  writeFileSync(join(started.dir, "root", "aide", "specs", FOLDER, "4-status.json"), STATE_JSON);
  ran(started.dir, ["analyze", "implement"]);
  await waitUntil(
    async () => (await (await fetch(`${base}/specs?live=0`)).text()).includes("tick them under › on the Specs list, or on the Status tab"),
    10_000,
    "the specs list to carry the acceptance hold-back message",
  );
});

afterAll(async () => { await browser.close(); harness.cleanup(); });

const notice = () => page.locator(`tr.specnotice[data-folder="${FOLDER}"]`);

describe("the criteria unfolded on the specs list", () => {
  test("the › unfolds and folds the criteria in place", async () => {
    await page.goto(`${base}/specs?live=0`);
    expect(await notice().locator("input[name=\"tick\"]").count()).toBe(0);
    await notice().locator("a.fold").click();
    await page.waitForSelector(`tr.specnotice[data-folder="${FOLDER}"] input[name="tick"]`);
    expect(await notice().locator("input[name=\"tick\"]").count()).toBe(2);
    await notice().locator("a.fold").click();
    await page.waitForSelector(`tr.specnotice[data-folder="${FOLDER}"] .rowchecks`, { state: "detached" });
  });

});

// Last: it ticks every criterion, and the list has nothing to unfold after.
describe("saving from the list", () => {
  test("ticking one and saving keeps the message, ticking the last one takes it away, and nothing is started", async () => {
    await page.goto(`${base}/specs?live=0&checks=aide%2F${FOLDER}`);
    // A save replaces the whole row (row-swap.ts), so the next tick has
    // to go on the row that came BACK: waiting for "one is checked" is
    // true of the old node too, and a box ticked there goes with it —
    // the save after it then posted a form with nothing ticked.
    const save = async (): Promise<void> => {
      const before = await notice().locator("form.rowchecks").elementHandle();
      await notice().locator("form.rowchecks button").click();
      if (before) await page.waitForFunction((el) => !(el as Element).isConnected, before, { timeout: 10_000 });
    };
    await notice().locator(`input[name="tick"]`).first().check();
    await save();
    await waitUntil(async () => (await notice().locator("input[name=\"tick\"]:checked").count()) === 1, 10_000, "the first tick to be saved");
    expect(await notice().textContent()).toContain("tick them under › on the Specs list, or on the Status tab");
    await notice().locator(`input[name="tick"]`).nth(1).check();
    await save();
    await waitUntil(async () => (await notice().count()) === 0 || !(await notice().textContent())?.includes("tick them"), 10_000, "the message to go");
    const jobs = (await (await fetch(`${base}/api/queue`, { headers: { accept: "application/json" } })).json()).jobs;
    expect(jobs).toEqual([]);
  });
});
