// The acceptance gate's human half (spec 382): every existing test of
// "held back until every Acceptance row is ticked" asserts on rendered
// HTML in isolation — never on a page a person could click. This file
// opens a real browser, reads the row's own message off the specs list,
// ticks the row on the Checks tab through a real checkbox and a real
// form submit, and presses the row's real Run/Archive control to prove
// the hold is actually gone — the other half of the proof
// `dashboard/test/round`'s sixth fixture gives on the machine side.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { queueHarness, ran } from "../helpers/queue-server.ts";
// spec-checks-fixtures.ts sets process.env.AIDE_WRITE_SPEC_BIN as a module-level
// side effect that the tick route's real `aide-write-spec` subprocess
// call resolves against — `recording()` (built on `spec-save-fixtures.ts`'s
// own `savable()`) is reused here rather than a hand-rolled stub, so the
// write the browser's own Save triggers actually lands.
import { recording } from "../spec-page/spec-checks-fixtures.ts";

setDefaultTimeout(20_000);
const TOKEN = "s3cret-token";
const FOLDER = "81-queue-and-runner";
const ACCEPTANCE_ROW = "| REQ-1: a person has judged this | ⬜ | |";
const STATUS = [
  "# Queue - Status", "",
  "## Tracking info", "",
  "- **Workflow steps completed:** analyze, implement", "",
  "## Acceptance criteria", "",
  "| Task | Status | Notes |", "|------|--------|-------|",
  ACCEPTANCE_ROW, "",
].join("\n");

// mirrors acceptance-hold-back-reads-the-branch.test.ts's own JSON shape,
// which is proven against the real reader (readSpecState)
const STATE_JSON = JSON.stringify({
  completedPhases: ["analyze", "implement"], archived: null, reopened: null,
  acceptanceCriteria: [{ task: "REQ-1: a person has judged this", done: false }], phaseCounts: {},
});

const harness = queueHarness("aide-e2e-acceptance-");
let browser: Browser;
let page: Page;
let base: string;

/** Poll until a condition holds, or give up saying which one did not.
 *  For anything the board reaches by its OWN poll rather than by the
 *  write that caused it: a fixed sleep has to guess how long that poll
 *  takes, and a guess that is long enough on an idle machine is not long
 *  enough on a loaded one. */
async function waitUntil(cond: () => Promise<boolean>, ms: number, label: string): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await cond()) return;
    if (Date.now() >= deadline) throw new Error(`${label} did not happen within ${ms}ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

// A bounded wait around every browser/page call, not just error handling —
// the same helper specs-page-layout.test.ts uses.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} did not resolve within ${ms}ms`)), ms),
    ),
  ]);
}

beforeAll(async () => {
  browser = await withTimeout(chromium.launch(), 15_000, "chromium.launch()");
  page = await browser.newPage();
  const started = harness.start({
    extra: { queueToken: TOKEN, gitRun: recording().run },
    status: STATUS,
  });
  base = started.base;
  writeFileSync(join(started.dir, "root", "aide", "specs", FOLDER, "4-status.json"), STATE_JSON);
  // archiveHeldBackApplies() only shows the row's message once `done`
  // (freshness-verified against real git history) includes "implement" —
  // the hand-written status/state files alone are not enough. Mirrors
  // specs-page-layout.test.ts's own beforeAll.
  ran(started.dir, ["analyze", "implement"]);
  // The row carries its acceptance message only once the freshness check
  // has verified "implement" against real git history, and the list
  // reaches that by its own poll, not by the write above. A fixed sleep
  // here raced that poll and lost under load — the row was left on its
  // honest interim message ("the files disagree with what has run") and
  // REQ-4 went red on a board that was working correctly. Waiting for the
  // message itself removes the guess without weakening what REQ-4 proves:
  // a board that never shows it still fails, on the bound below.
  await waitUntil(
    async () => {
      const res = await fetch(`${base}/?token=${TOKEN}&live=0`);
      return (await res.text()).includes("tick them on the Checks tab");
    },
    10_000,
    "the specs list to carry the acceptance hold-back message",
  );
});

afterAll(async () => { await browser.close(); harness.cleanup(); });

describe("the acceptance gate, on a page a person could click", () => {
  test("REQ-4: the specs list names the Checks tab", async () => {
    await withTimeout(page.goto(`${base}/?token=${TOKEN}&live=0`), 10_000, "page.goto(/)");
    const notice = page.locator(`tr.specnotice[data-folder="${FOLDER}"]`);
    expect(await notice.textContent()).toContain("tick them on the Checks tab");
  });

  test("REQ-5: ticking the row clears the message and archive becomes possible", async () => {
    await withTimeout(page.goto(`${base}/specs/aide/${FOLDER}?tab=checks&live=0`), 10_000, "page.goto(checks)");
    await page.locator(`input[name="tick"][value="${ACCEPTANCE_ROW}"]`).check();
    await Promise.all([
      page.waitForNavigation(),
      page.locator("form.specform button[type=\"submit\"]").click(),
    ]);
    expect(await page.locator(".checklist .check.open").count()).toBe(0);

    // The specs list's own cache polls on `specCachePollMs`, not on this
    // save — the same short settle `specs-page-layout.test.ts`'s beforeAll
    // waits out after a git-history change lands.
    await new Promise((r) => setTimeout(r, 300));
    // Open: the row's one action rides the caption line the fold opens
    // (2026-09-08), so a shut row has no button to press.
    await withTimeout(
      page.goto(`${base}/?token=${TOKEN}&live=0&open=aide%2F${FOLDER}`),
      10_000,
      "page.goto(/) again",
    );
    const notice = page.locator(`tr.specnotice[data-folder="${FOLDER}"]`);
    const noticeCount = await notice.count();
    const noticeText = noticeCount > 0 ? await notice.textContent() : "";
    expect(noticeText).not.toContain("tick them on the Checks tab");

    // "archive becomes possible" (REQ-5): press the row's real
    // Run/Archive control and confirm the resulting queued job is NOT
    // held for the acceptance reason any more.
    await page.getByRole("button", { name: /archive/i }).click();
    const queued = await withTimeout(
      page.request.get(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } }),
      5_000, "GET /api/queue",
    ).then((r) => r.json());
    const job = queued.jobs.find((j: { specFolder: string }) => j.specFolder === FOLDER);
    expect(job?.error?.key).not.toBe("runner.acceptanceCriteriaUnticked");
  });
});
