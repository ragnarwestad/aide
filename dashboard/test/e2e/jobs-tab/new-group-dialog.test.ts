// The New group dialog on the Jobs tab, in a browser: a refused Save stays
// in it with the reason, and a saved group's card appears on the tab. The
// tab is opened without live updates, so the card can only come from the
// redraw the dialog's own close makes.

import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Browser, Locator, Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { e2eBrowser } from "../../helpers/setup/e2e-browser.ts";
import { queueHarness } from "../../helpers/queue-server.ts";
import { makeSpecsRepo } from "../../helpers/specs-repo.ts";
import { t } from "../../../src/i18n";
import { NEW_GROUP_DIALOG } from "../../../src/render/pages/jobs-page/execution-group-editor.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-new-group-dialog-");
let browser: Browser;
let page: Page;

const FIRST = "81-queue-and-runner";
const SECOND = "82-next";
const description = (folder: string) => `# ${folder}\n\n## Tracking info\n\n- **Created:** \`2026-11-11\`\n`;

e2eBrowser(harness, (launched) => {
  browser = launched;
});
beforeEach(async () => {
  page = await browser.newPage();
});
afterEach(async () => {
  await page.close();
});

const dialog = (): Locator => page.locator(`dialog#${NEW_GROUP_DIALOG}`);
const name = (): Locator => dialog().locator('input[name="name"]');
const member = (folder: string): Locator => dialog().locator(`input[name="member"][value="${folder}"]`);
const inDialog = (label: string): Locator => dialog().getByRole("button", { name: label, exact: true });
const save = (): Locator => inDialog(t("en", "list.checksSave"));
const card = (): Locator => page.getByRole("button", { name: "Release", exact: true });

/** The Jobs tab of a board with two specs a group can be made of, in a specs repository that can save. */
async function openTab(): Promise<void> {
  const { base, dir } = harness.start({
    description: description(FIRST),
    alsoSpecs: [SECOND],
    alsoDescriptions: { [SECOND]: description(SECOND) },
  });
  makeSpecsRepo(dir);
  await withBrowser(page.goto(`${base}/specs?live=0`), "page.goto(Specs)");
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
}

async function openDialog(): Promise<void> {
  await page.getByRole("button", { name: t("en", "list.groupCreate"), exact: true }).click();
  await dialog().waitFor({ state: "visible" });
}

test("a refused Save keeps the dialog open with what was typed and the reason in it (AC-5)", async () => {
  await openTab();
  await openDialog();
  await name().fill("Release");
  await member(FIRST).check();
  await save().click();
  await dialog().locator(".refused span", { hasText: /\S/ }).waitFor();
  expect(await dialog().isVisible()).toBe(true);
  expect(await name().inputValue()).toBe("Release");
  expect(await member(FIRST).isChecked()).toBe(true);
});

test("Save keeps the order the specs were selected", async () => {
  await openTab();
  await openDialog();
  await name().fill("Release");
  await member(SECOND).check();
  await member(FIRST).check();
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/queue/groups" && r.request().method() === "POST");
  await save().click();
  expect(await (await response).json()).toMatchObject({ group: { members: [SECOND, FIRST] } });
  await card().waitFor({ state: "visible" });
  expect(await dialog().isVisible()).toBe(false);
});
