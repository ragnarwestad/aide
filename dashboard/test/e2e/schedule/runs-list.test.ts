// The runs list under a scheduled job's report, in a browser: a click on
// a run's row shows that run's report and marks the row.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { scheduleRunOutputDir } from "../../../src/queue/schedule.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const KEY = "schedule-nightly-report";
// Both runs newer than the cron's most recent fire, or the board reads
// the entry as overdue and enqueues a run of its own.
const NEWER = new Date().toISOString();
const OLDER = new Date(Date.now() - 1000).toISOString();

const harness = queueHarness("aide-e2e-schedule-runs-");
let browser: Browser;
let base: string;

beforeAll(async () => {
  const scratch = mkdtempSync(join(tmpdir(), "aide-e2e-schedule-runs-"));
  const outputRoot = join(scratch, "out");
  const seeds = [
    { id: "older", at: OLDER, report: "<h1>OLDER-REPORT</h1>" },
    { id: "newer", at: NEWER, report: "<h1>NEWER-REPORT</h1>" },
  ];
  for (const s of seeds) {
    const dir = scheduleRunOutputDir(outputRoot, "aide", KEY, s.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), s.report);
  }
  writeFileSync(
    join(scratch, "queue.json"),
    JSON.stringify(
      seeds.map((s) => ({
        id: s.id, project: "aide", specFolder: KEY, steps: ["schedule"], stepIndex: 0, state: "done",
        timeoutSec: {}, permissionMode: {}, model: {}, createdAt: s.at, startedAt: s.at, finishedAt: s.at,
      })),
    ),
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
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

test("a click on an older run's row shows its report and marks the row (AC-3)", async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/schedule/aide/nightly-report?live=0`);
  const frame = page.frameLocator("iframe[data-report-frame]");
  await frame.locator("h1", { hasText: "NEWER-REPORT" }).waitFor();

  // The State cell, not the row's link: the whole row opens the run.
  await page.locator('#runs tbody tr[data-row-href*="run=older"] td').nth(1).click();
  await page.waitForURL((u) => u.searchParams.get("run") === "older");
  await frame.locator("h1", { hasText: "OLDER-REPORT" }).waitFor();
  const marked = page.locator('#runs tbody tr[aria-current="true"]');
  expect(await marked.count()).toBe(1);
  expect(await marked.getAttribute("data-row-href")).toContain("run=older");
  await page.close();
});
