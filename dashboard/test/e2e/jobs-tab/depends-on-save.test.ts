// The Depends on picker on the Running tab's open row, in a real browser:
// Save writes the line without loading the page again and the row keeps the
// tick, and Cancel unticks what was ticked.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { SPEC, createSpecSaveHarness, descriptionPath, savable } from "../../spec-page/spec-save-fixtures.ts";

browserDeadline();

const OTHER = "99-a-second-spec";
const TRACKED =
  "# Queue and runner - Description\n\n## Tracking info\n\n" +
  `- **Task:** \`${SPEC}/\`\n- **Created:** \`2026-08-21\`\n\n---\n\n## Description\n\nAs it was.\n`;
const FORM = `form[id="depends-aide-${SPEC}"]`;

const { harness } = createSpecSaveHarness("aide-e2e-depends-on-save-");
let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

async function openRow(): Promise<{ page: Page; dir: string; loads: { n: number } }> {
  const { base, dir } = harness.start({ description: TRACKED, alsoSpecs: [OTHER], extra: { gitRun: savable("/host") } });
  const page = await browser.newPage();
  await page.goto(`${base}/?open=aide/${SPEC}&live=0`);
  await page.locator(FORM).waitFor({ timeout: 10_000 });
  const loads = { n: 0 };
  page.on("load", () => loads.n++);
  return { page, dir, loads };
}

test("Save writes the Depends on line with no page load, and the redrawn row holds the tick", async () => {
  const { page, dir, loads } = await openRow();
  await page.locator(`${FORM} input[name="dependsOn"][value="${OTHER}"]`).check();
  await page.locator(`#depends-aide-${SPEC}-save`).click();
  const deadline = Date.now() + 10_000;
  while (!readFileSync(descriptionPath(dir), "utf-8").includes(`- **Depends on:** \`${OTHER}\``)) {
    if (Date.now() > deadline) throw new Error("the Depends on line was not written");
    await new Promise((r) => setTimeout(r, 50));
  }
  expect(loads.n).toBe(0);
  expect(await page.locator(`${FORM} input[name="dependsOn"][value="${OTHER}"]`).isChecked()).toBe(true);
  await page.close();
});

test("Cancel unticks what was ticked and is disabled again", async () => {
  const { page } = await openRow();
  const box = page.locator(`${FORM} input[name="dependsOn"][value="${OTHER}"]`);
  const cancel = page.locator(`#depends-aide-${SPEC}-cancel`);
  expect(await cancel.isDisabled()).toBe(true);
  await box.check();
  expect(await cancel.isEnabled()).toBe(true);
  await cancel.click();
  expect(await box.isChecked()).toBe(false);
  expect(await cancel.isDisabled()).toBe(true);
  await page.close();
});
