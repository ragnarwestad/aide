// Spec 495, criteria 10 and 12: what a report's frame does in a real
// browser. The sandbox and the theme exist only there, so a unit test can
// say what the markup carries but not what happens. Run by the user.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import { scheduleRunOutputDir } from "../../src/queue/schedule.ts";
import { queueHarness } from "../helpers/queue-server.ts";

browserDeadline();

const KEY = "schedule-nightly-report";
// The run has to be newer than the cron's most recent fire, or the board
// rightly reads the entry as overdue, enqueues one of its own, and the
// page shows THAT run — which has no report. A fixed date made the test
// pass on the day it was written and rot every day after.
const NOW = new Date().toISOString();
const LONG_NEWS = "Opt-in gateway hint header; managed settings; MCP tool output saved to files; faster first request; ".repeat(3);
const REPORT =
  `<html><body style="background:#ff00ff;color:#00ff00"><h1>Findings</h1>` +
  `<script>document.title = "script-ran"</script><a href="https://example.com/">link</a>` +
  `<table><tr><th>Date</th><th>Version</th><th>News</th><th>Source</th></tr>` +
  `<tr><td>2026-09-25</td><td>2.1.283</td><td>${LONG_NEWS}</td><td><a href="https://example.com/r">Releases</a></td></tr>` +
  `</table></body></html>`;

const harness = queueHarness("aide-e2e-report-frame-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  const scratch = mkdtempSync(join(tmpdir(), "aide-e2e-report-"));
  const outputRoot = join(scratch, "out");
  const dir = scheduleRunOutputDir(outputRoot, "aide", KEY, "run1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), REPORT);
  writeFileSync(
    join(scratch, "queue.json"),
    JSON.stringify([
      {
        id: "run1", project: "aide", specFolder: KEY, steps: ["schedule"], stepIndex: 0, state: "done",
        timeoutSec: {}, permissionMode: {}, model: {}, createdAt: NOW, startedAt: NOW,
      },
    ]),
  );
  const queueConfigFile = join(scratch, "queue-config.json");
  writeFileSync(
    queueConfigFile,
    JSON.stringify({ schedules: { aide: [{ name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md" }] } }),
  );
  const started = harness.start({
    extra: { scheduleOutputRoot: outputRoot, queueMirrorPath: join(scratch, "queue.json"), queueConfigFile },
  });
  base = started.base;
  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

async function frameColours(scheme: "light" | "dark"): Promise<{ frame: string[]; page: string[] }> {
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(`${base}/schedule/aide/nightly-report?live=0`);
  const frame = page.frameLocator("iframe[data-report-frame]");
  await frame.locator("h1").waitFor();
  const read = (el: Element): string[] => {
    const s = getComputedStyle(el);
    return [s.color, s.backgroundColor];
  };
  return {
    frame: await frame.locator("body").evaluate(read),
    page: await page.locator("body").evaluate(read),
  };
}

const TRANSPARENT = "rgba(0, 0, 0, 0)";

for (const scheme of ["light", "dark"] as const) {
  test(`the framed report uses the board's own text and background in ${scheme} mode`, async () => {
    const { frame, page: host } = await frameColours(scheme);
    // Text: the board's own, exactly — the report's `color:#00ff00` must
    // not win.
    expect(frame[0]).toBe(host[0]);
    // Background: the board's own, or none of its own, which is the same
    // thing to look at since the board's paints through a frame that does
    // not. The report's `background:#ff00ff` would read as itself here,
    // which is what this holds onto.
    expect([host[1], TRANSPARENT]).toContain(frame[1]);
    expect(frame[0]).not.toBe("rgb(0, 255, 0)");
    expect(frame[1]).not.toBe("rgb(255, 0, 255)");
  });
}

test("a script in the report does not run, and a click on its link opens a new tab", async () => {
  await page.goto(`${base}/schedule/aide/nightly-report?live=0`);
  const frame = page.frameLocator("iframe[data-report-frame]");
  await frame.locator("h1").waitFor();
  expect(await page.title()).not.toBe("script-ran");
  const popup = page.waitForEvent("popup");
  await frame.locator('a[href="https://example.com/"]').click();
  const tab = await popup;
  expect(tab.url()).toContain("example.com");
});

// A short value — a date, a version, one word — keeps to one line beside
// a long one, and a table wider than a phone scrolls inside itself rather
// than taking the whole report sideways.
test("a table's short cells keep to one line, and a table wider than a phone scrolls on its own", async () => {
  for (const width of [1000, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/schedule/aide/nightly-report?live=0`);
    const frame = page.frameLocator("iframe[data-report-frame]");
    await frame.locator("table").waitFor();
    const m = await frame.locator("body").evaluate(() => {
      const lines = (el: Element) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size;
      };
      const cells = [...document.querySelectorAll("tr:last-child td")];
      return {
        short: [cells[0]!, cells[1]!, cells[3]!].map(lines),
        sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect([width, m.short]).toEqual([width, [1, 1, 1]]);
    expect([width, m.sideways]).toEqual([width, 0]);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
});
