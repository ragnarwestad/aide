// A Description edited on its tab and saved is written as edited, and the
// reader stays on the spec's page: Save is the tab form's own post, never
// the New-spec form's handler.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import { DESCRIPTION, DESCRIPTION_TAB, PAGE, createSpecSaveHarness, descriptionPath, savable } from "../spec-page/spec-save-fixtures.ts";

browserDeadline();

const { harness, start } = createSpecSaveHarness("aide-e2e-description-save-");
let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

test("Save on the Description tab writes the edited text and stays on the spec's page (AC-5)", async () => {
  const { base, dir } = start(savable("/host"));
  const page = await browser.newPage();
  await page.goto(`${base}${DESCRIPTION_TAB}&live=0`);
  const editor = page.locator("#spec-editor-host [contenteditable=true]:visible").first();
  await editor.waitFor({ state: "visible" });
  await editor.click();
  await editor.pressSequentially(" Edited in the browser.");
  await page.locator("#specform-save").click();
  await page.waitForURL((u) => new URL(u).pathname === PAGE && readFileSync(descriptionPath(dir), "utf-8") !== DESCRIPTION);
  expect(readFileSync(descriptionPath(dir), "utf-8")).toContain("Edited in the browser.");
  expect(new URL(page.url()).pathname).toBe(PAGE);
  await page.close();
});
