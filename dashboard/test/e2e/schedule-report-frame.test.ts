// What a report's frame does in a real browser: the sandbox exists only
// there, so a unit test can say what the markup carries but not what
// happens.

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
