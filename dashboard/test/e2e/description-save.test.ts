// A Description edited on its tab and saved is written as edited, and the
// reader stays on the spec's page: Save is posted by the page script, with
// the editor's text, and a refusal is shown on the page with the text kept.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import { DESCRIPTION, DESCRIPTION_TAB, PAGE, SPEC, createSpecSaveHarness, descriptionPath, savable } from "../spec-page/spec-save-fixtures.ts";

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

const EDIT = " Edited in the browser.";

test("Save on the Description tab is posted by the page script, writes the edited text and stays on the spec's page (AC-4)", async () => {
  const { base, dir } = start(savable("/host"));
  const page = await browser.newPage();
  await page.goto(`${base}${DESCRIPTION_TAB}&live=0`);
  const editor = page.locator("#spec-editor-host [contenteditable=true]:visible").first();
  await editor.waitFor({ state: "visible" });
  await editor.click();
  await editor.pressSequentially(EDIT);
  const save = page.locator("#specform-save");
  let seen = null as { accept: string; disabled: boolean } | null;
  await page.route("**/save", async (route) => {
    seen = { accept: route.request().headers().accept ?? "", disabled: await save.isDisabled() };
    await route.continue();
  });
  await save.click();
  await page.waitForURL((u) => new URL(u).pathname === PAGE && readFileSync(descriptionPath(dir), "utf-8") !== DESCRIPTION);
  expect(seen).toEqual({ accept: "application/json", disabled: true });
  expect(readFileSync(descriptionPath(dir), "utf-8")).toContain("Edited in the browser.");
  expect(new URL(page.url()).pathname).toBe(PAGE);
  await page.close();
});

test("a refused Save shows why on the page and keeps the typed text in the editor (AC-6)", async () => {
  const { base, dir } = start(savable("/host"));
  const page = await browser.newPage();
  await page.goto(`${base}${DESCRIPTION_TAB}&live=0`);
  const editor = page.locator("#spec-editor-host [contenteditable=true]:visible").first();
  await editor.waitFor({ state: "visible" });
  await editor.click();
  await editor.pressSequentially(EDIT);
  // A job queued for the spec while the text was being typed: the Save
  // that follows is refused.
  const queued = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["analyze"] }),
  });
  expect(queued.status).toBe(200);
  await page.locator("#specform-save").click();
  await page.waitForFunction(() =>
    (document.getElementById("spec-refused")?.textContent ?? "").toLowerCase().includes("another job for this spec is still running"),
  );
  expect(await editor.textContent()).toContain("Edited in the browser.");
  expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
  await page.close();
});
