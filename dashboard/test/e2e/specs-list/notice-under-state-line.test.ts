// A message under a shut spec's state line — `N not verified` among them —
// sits 6px under it on a desktop: the message brings its own box, and the
// 10px a row edge has left it looking detached from its spec.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../../helpers/queue-server.ts";

browserDeadline();

const status = [
  "# Queue - Status", "",
  "## Tracking info", "",
  "- **Workflow steps completed:** analyze, implement", "",
  "## Acceptance criteria", "",
  "| Task | Status | Notes |", "|------|--------|-------|",
  "| AC-1: it deploys | Not verified | Not tested: needs production |", "",
].join("\n");
const liveState = JSON.stringify({
  completedPhases: ["analyze", "implement"], archived: null, reopened: null,
  acceptanceCriteria: [{ task: "AC-1: it deploys", done: true, notVerified: true }], phaseCounts: {},
});

const harness = queueHarness("aide-e2e-notice-gap-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage({ viewport: { width: 1270, height: 900 } });
  const started = harness.start({ extra: {}, status, liveState });
  base = started.base;
  ran(started.dir, ["analyze", "implement"]);
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

test("the state line leaves 6px under its cells when a message follows", async () => {
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
  await page.waitForSelector("tr.specnotice");
  const pads = await page.evaluate(() =>
    [...document.querySelectorAll("tr.specstate > td")].map((td) => getComputedStyle(td).paddingBottom),
  );
  expect(pads.length).toBeGreaterThan(0);
  for (const p of pads) expect(p).toBe("6px");
});

test("a message with the › that opens its criteria stands as tall as one without", async () => {
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
  const heights = await page.evaluate(() => {
    const msg = document.querySelector("tr.specnotice .rowmsg:has(a.fold)") as HTMLElement;
    const bare = msg.cloneNode(true) as HTMLElement;
    bare.querySelector("a.fold")!.remove();
    msg.after(bare);
    return [msg.getBoundingClientRect().height, bare.getBoundingClientRect().height];
  });
  expect(Math.abs(heights[0]! - heights[1]!)).toBeLessThanOrEqual(1);
});
