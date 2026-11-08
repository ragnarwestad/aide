// A scheduled job's prompt file page, in a browser: the viewer mounts and
// draws the committed Markdown, which only a browser can show.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { projectWithOrigin } from "../../helpers/branch-fixture.ts";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-schedule-prompt-");
let browser: Browser;
let base: string;

beforeAll(async () => {
  const scratch = mkdtempSync(join(tmpdir(), "aide-e2e-schedule-prompt-"));
  const queueConfigFile = join(scratch, "queue-config.json");
  // Stamped in the future, so the board's own tick does not find it due.
  const since = new Date(Date.now() + 3_600_000).toISOString();
  writeFileSync(
    queueConfigFile,
    JSON.stringify({ schedules: { aide: [{ name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", since }] } }),
  );
  const started = harness.start({ extra: { queueConfigFile } });
  projectWithOrigin(started.dir, "aide", { "docs/nightly.md": "# Nightly\n\nWhat the job does.\n" });
  base = started.base;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

test("the viewer mounts and draws the file's first line as a heading", async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/schedule/aide/nightly-report/prompt`);
  await page.locator("#spec-editor-host[data-mounted]").waitFor();
  // Inside the viewer only: the page's own <h1> names the file, not "Nightly".
  const heading = page.locator("#spec-editor-host").getByRole("heading", { name: "Nightly", exact: true });
  await heading.waitFor();
  expect(await heading.count()).toBe(1);
  await page.close();
});
