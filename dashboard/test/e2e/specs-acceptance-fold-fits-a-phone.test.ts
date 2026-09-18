// Spec 493: the acceptance criteria unfolded on the specs list, in a real
// browser. The unit tests prove the markup, the route and the remembered
// ticks; whether the › works as a link, whether the boxes outside the form
// post through `form=`, and whether a 200-character criterion wraps inside a
// 375px screen are questions only a browser answers.
//
// Not run by this round: Aide is not a project where the session runs the
// e2e suite. Written so the check exists; run it with
// `cd dashboard && bun test test/e2e/specs-acceptance-fold-fits-a-phone.test.ts`.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { queueHarness, ran } from "../helpers/queue-server.ts";
import { recording } from "../spec-page/spec-checks-fixtures.ts";

setDefaultTimeout(20_000);
const TOKEN = "s3cret-token";
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
  const started = harness.start({ extra: { queueToken: TOKEN, gitRun: recording().run }, status: STATUS });
  base = started.base;
  writeFileSync(join(started.dir, "root", "aide", "specs", FOLDER, "4-status.json"), STATE_JSON);
  ran(started.dir, ["analyze", "implement"]);
  await waitUntil(
    async () => (await (await fetch(`${base}/?token=${TOKEN}&live=0`)).text()).includes("tick them on the Checks tab"),
    10_000,
    "the specs list to carry the acceptance hold-back message",
  );
});

afterAll(async () => { await browser.close(); harness.cleanup(); });

const notice = () => page.locator(`tr.specnotice[data-folder="${FOLDER}"]`);

describe("the criteria unfolded on the specs list", () => {
  test("the › unfolds and folds the criteria in place", async () => {
    await page.goto(`${base}/?token=${TOKEN}&live=0`);
    expect(await notice().locator("input[name=\"tick\"]").count()).toBe(0);
    await notice().locator("a.fold").click();
    await page.waitForSelector(`tr.specnotice[data-folder="${FOLDER}"] input[name="tick"]`);
    expect(await notice().locator("input[name=\"tick\"]").count()).toBe(2);
    await notice().locator("a.fold").click();
    await page.waitForSelector(`tr.specnotice[data-folder="${FOLDER}"] .rowchecks`, { state: "detached" });
  });

  // This harness has no origin remote, so no test server is offered and
  // the row draws the held-back box alone; the two-box case is the unit
  // test's (`acceptance-fold.test.ts`). What a browser adds: the box is
  // one line and carries the › inside it.
  test("the held-back message is a box of its own, with the › inside it", async () => {
    await page.goto(`${base}/?token=${TOKEN}&live=0`);
    const held = notice().locator(".rowmsg").first();
    expect(await held.locator("a.fold").count()).toBe(1);
    expect(await held.textContent()).not.toContain(" · ");
  });
});

describe("at phone width", () => {
  test("a 200-character criterion wraps inside the list and nothing scrolls sideways (375px)", async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`${base}/?token=${TOKEN}&live=0&checks=aide%2F${FOLDER}`);
    const box = page.locator(".rowchecks .checktask").first();
    await box.waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

// Last: it ticks every criterion, and the list has nothing to unfold after.
describe("saving from the list", () => {
  test("ticking one and saving keeps the message, ticking the last one takes it away, and nothing is started", async () => {
    await page.goto(`${base}/?token=${TOKEN}&live=0&checks=aide%2F${FOLDER}`);
    await notice().locator(`input[name="tick"]`).first().check();
    await notice().locator("form.rowchecks button").click();
    await waitUntil(async () => (await notice().locator("input[name=\"tick\"]:checked").count()) === 1, 10_000, "the first tick to be saved");
    expect(await notice().textContent()).toContain("tick them on the Checks tab");
    await notice().locator(`input[name="tick"]`).nth(1).check();
    await notice().locator("form.rowchecks button").click();
    await waitUntil(async () => (await notice().count()) === 0 || !(await notice().textContent())?.includes("tick them"), 10_000, "the message to go");
    const jobs = (await (await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN, accept: "application/json" } })).json()).jobs;
    expect(jobs).toEqual([]);
  });
});
