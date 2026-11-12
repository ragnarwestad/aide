// The New group dialog on the Jobs tab, in a browser: the button opens it,
// Cancel closes it with nothing saved and it opens again empty, a refused
// Save stays in it with the reason, and a saved group's card appears on the
// tab. The tab is opened without live updates, so the card can only come
// from the redraw the dialog's own close makes.

import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
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

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
});
beforeEach(async () => {
  page = await browser.newPage();
});
afterEach(async () => {
  await page.close();
});
afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

const dialog = (): Locator => page.locator(`dialog#${NEW_GROUP_DIALOG}`);
const name = (): Locator => dialog().locator('input[name="name"]');
const member = (folder: string): Locator => dialog().locator(`input[name="member"][value="${folder}"]`);
const inDialog = (label: string): Locator => dialog().getByRole("button", { name: label, exact: true });
const save = (): Locator => inDialog(t("en", "list.checksSave"));
const cancel = (): Locator => inDialog(t("en", "dialog.cancel"));
const card = (): Locator => page.getByRole("button", { name: "Release", exact: true });

/** The Jobs tab of a board with two specs a group can be made of, in a specs repository that can save. */
async function openTab(): Promise<void> {
  const { base, dir } = harness.start({
    description: description(FIRST),
    alsoSpecs: [SECOND],
    alsoDescriptions: { [SECOND]: description(SECOND) },
  });
  makeSpecsRepo(dir);
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
}

async function openDialog(): Promise<void> {
  await page.getByRole("button", { name: t("en", "list.groupCreate"), exact: true }).click();
  await dialog().waitFor({ state: "visible" });
}

test("New group opens a dialog with Project, Name, the eligible specs and their order, Save and Cancel (AC-2)", async () => {
  await openTab();
  await openDialog();
  expect(await dialog().locator('select[name="project"]').isVisible()).toBe(true);
  expect(await name().isVisible()).toBe(true);
  for (const folder of [FIRST, SECOND]) expect(await member(folder).isVisible()).toBe(true);
  expect(await dialog().locator('input[name="position"]').count()).toBe(2);
  expect(await save().isVisible()).toBe(true);
  expect(await cancel().isVisible()).toBe(true);
});

test("Cancel closes the dialog, saves nothing, and the dialog opens again empty (AC-3)", async () => {
  await openTab();
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/queue/groups") posts++;
  });
  await openDialog();
  await name().fill("Release");
  await member(FIRST).check();
  await member(SECOND).check();
  await cancel().click();
  await dialog().waitFor({ state: "hidden" });

  await openDialog();
  expect(await name().inputValue()).toBe("");
  expect(await dialog().locator('input[name="member"]:checked').count()).toBe(0);
  expect(posts).toBe(0);
  expect(await card().count()).toBe(0);
});

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

test("Save with a name and two specs closes the dialog and the tab shows the group's card (AC-4)", async () => {
  await openTab();
  await openDialog();
  await name().fill("Release");
  await member(FIRST).check();
  await member(SECOND).check();
  await save().click();
  await card().waitFor({ state: "visible" });
  expect(await dialog().isVisible()).toBe(false);
});
