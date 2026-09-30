// Editing a schedule entry on its own Settings tab, in a browser: Edit
// turns the fields into inputs, a refused Save keeps what was typed, and
// a Save that goes through shows the tab with the saved values.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-schedule-settings-");
let browser: Browser;
let base: string;

beforeAll(async () => {
  const scratch = mkdtempSync(join(tmpdir(), "aide-e2e-schedule-settings-"));
  const queueConfigFile = join(scratch, "queue-config.json");
  // Stamped in the future, so the board's own tick does not find it due.
  const since = new Date(Date.now() + 3_600_000).toISOString();
  writeFileSync(
    queueConfigFile,
    JSON.stringify({ schedules: { aide: [{ name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", since }] } }),
  );
  const started = harness.start({ extra: { queueConfigFile } });
  // The save checks that the prompt file is in the project's checkout.
  mkdirSync(join(started.dir, "root", "aide", "docs"), { recursive: true });
  writeFileSync(join(started.dir, "root", "aide", "docs", "nightly.md"), "# nightly\n");
  base = started.base;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

test("Edit, a refused Save that keeps what was typed, then a Save that shows the saved values (AC-5)", async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/schedule/aide/nightly-report?tab=settings`);
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  const cron = page.locator('form.scheduleform input[name="cron"]');
  await cron.waitFor();

  await cron.fill("not a cron");
  await page.getByRole("button", { name: "Save" }).click();
  await page.locator("form.scheduleform .refused", { hasText: "not a valid cron expression" }).waitFor();
  expect(await cron.inputValue()).toBe("not a cron");

  await cron.fill("0 5 * * *");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL((u) => u.searchParams.get("tab") === "settings" && !u.searchParams.has("edit"));
  await page.locator("table.facts", { hasText: "0 5 * * *" }).waitFor();
  expect(await page.locator('input[name="cron"]').count()).toBe(0);
  await page.close();
});

test("Delete on the Settings tab lands on the project's Schedule tab, without the entry (AC-4)", async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/schedule/aide/nightly-report?tab=settings`);
  await page.locator('button[data-ask="deleteask-aide/nightly-report"]').click();
  const box = page.locator('dialog[id="deleteask-aide/nightly-report"]');
  await box.waitFor({ state: "visible" });
  await box.getByRole("button", { name: "OK" }).click();
  await page.waitForURL((u) => u.pathname === "/projects/aide" && u.searchParams.get("tab") === "schedule");
  expect(await page.locator('a[href="/schedule/aide/nightly-report"]').count()).toBe(0);
  await page.close();
});
