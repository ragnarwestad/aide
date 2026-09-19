// Spec 495, criteria 10 and 12: what a report's frame does in a real
// browser. The sandbox and the theme exist only there, so a unit test can
// say what the markup carries but not what happens. Run by the user.

import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { scheduleRunOutputDir } from "../../src/queue/schedule.ts";
import { queueHarness } from "../helpers/queue-server.ts";

setDefaultTimeout(20_000);

const KEY = "schedule-nightly-report";
const REPORT =
  `<html><body style="background:#ff00ff;color:#00ff00"><h1>Findings</h1>` +
  `<script>document.title = "script-ran"</script><a href="https://example.com/">link</a></body></html>`;

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
        timeoutSec: {}, permissionMode: {}, model: {}, createdAt: "2026-09-18T03:00:00Z", startedAt: "2026-09-18T03:00:00Z",
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

for (const scheme of ["light", "dark"] as const) {
  test(`the framed report uses the board's own text and background in ${scheme} mode`, async () => {
    const { frame, page: host } = await frameColours(scheme);
    expect(frame).toEqual(host);
    expect(frame[0]).not.toBe("rgb(0, 255, 0)");
  });
}

test("a script in the report does not run, and a click on its link opens a new tab", async () => {
  await page.goto(`${base}/schedule/aide/nightly-report?live=0`);
  const frame = page.frameLocator("iframe[data-report-frame]");
  await frame.locator("h1").waitFor();
  expect(await page.title()).not.toBe("script-ran");
  const popup = page.waitForEvent("popup");
  await frame.locator("a").click();
  const tab = await popup;
  expect(tab.url()).toContain("example.com");
});
