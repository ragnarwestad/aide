// A list of acceptance criteria unfolded on a spec's row is locked the
// moment its Save is pressed: a box ticked while the list is being saved
// is a change the save never saw. Both places the list unfolds — under
// the not-verified count and under a row held back for its criteria —
// are one form each; whether a real browser leaves the boxes live while
// the post is in flight is the question.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../../helpers/queue-server.ts";
import { recording } from "../../spec-page/spec-checks-fixtures.ts";

browserDeadline();
const FOLDER = "81-queue-and-runner";
const KEY = encodeURIComponent(`aide/${FOLDER}`);

const status = (rows: string[]) =>
  [
    "# Queue - Status", "",
    "## Tracking info", "",
    "- **Workflow steps completed:** analyze, implement", "",
    "## Acceptance criteria", "",
    "| Task | Status | Notes |", "|------|--------|-------|",
    ...rows, "",
  ].join("\n");
const state = (rows: object[]) =>
  JSON.stringify({ completedPhases: ["analyze", "implement"], archived: null, reopened: null, acceptanceCriteria: rows, phaseCounts: {} });

const CASES = {
  "the not-verified count": {
    status: status(["| AC-1: it deploys | Not verified | Not tested: needs production |", "| AC-2: it saves | ✅ | |"]),
    state: state([{ task: "AC-1: it deploys", done: true, notVerified: true }, { task: "AC-2: it saves", done: true }]),
  },
  "a row held back for its criteria": {
    status: status(["| AC-1: it deploys | ⬜ | |", "| AC-2: it saves | ✅ | |"]),
    state: state([{ task: "AC-1: it deploys", done: false }, { task: "AC-2: it saves", done: true }]),
  },
};

let browser: Browser;
beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
});
afterAll(async () => {
  await browser.close();
});

describe("an unfolded list of criteria locks when its Save is pressed", () => {
  for (const [name, c] of Object.entries(CASES)) {
    test(`under ${name}`, async () => {
      const harness = queueHarness("aide-e2e-checks-lock-");
      const started = harness.start({ extra: { gitRun: recording().run }, status: c.status, liveState: c.state });
      ran(started.dir, ["analyze", "implement"]);
      const page: Page = await browser.newPage();
      try {
        // Hold the save: the boxes are read while it is in flight.
        let release: () => void = () => {};
        const held = new Promise<void>((r) => (release = r));
        await page.route("**/tick?fromList=1", async (route) => {
          await held;
          await route.abort();
        });
        await withBrowser(page.goto(`${started.base}/?live=0&state=all&checks=${KEY}`), "page.goto(/)");
        const form = page.locator("form.rowchecks");
        await form.waitFor();
        const boxes = page.locator(`input[type="checkbox"][form="${await form.getAttribute("id")}"]`);
        expect(await boxes.count()).toBeGreaterThan(0);
        for (const b of await boxes.all()) expect(await b.isDisabled()).toBe(false);
        await form.locator("button").click();
        await page.waitForFunction(() => document.querySelector("form.rowchecks button")?.classList.contains("busy"));
        for (const b of await boxes.all()) expect(await b.isDisabled()).toBe(true);
        release();
      } finally {
        await page.close();
        harness.cleanup();
      }
    });
  }
});
