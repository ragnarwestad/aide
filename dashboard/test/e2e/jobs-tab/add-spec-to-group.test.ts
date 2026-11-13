// Add spec on a group's card on the Jobs tab, in a browser: the button opens
// a dialog listing the specs the group can take, and Add closes it and the
// card shows its new member. The tab is opened without live updates, so the
// new member can only come from the redraw the dialog's own close makes.

import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";
import { makeSpecsRepo } from "../../helpers/specs-repo.ts";
import { t } from "../../../src/i18n";

browserDeadline();

const harness = queueHarness("aide-e2e-add-spec-to-group-");
let browser: Browser;
let page: Page;

const FIRST = "81-queue-and-runner";
const SECOND = "82-next";
const ADDED = "83-added";
const plain = (folder: string) => `# ${folder}\n\n## Tracking info\n\n- **Created:** \`2026-11-11\`\n`;
const grouped = (folder: string, position: number) => `${plain(folder)}- **Group:** \`Release\`\n- **Group position:** ${position}\n`;

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

const card = (): Locator => page.locator("tr.execution-group");
const dialog = (): Locator => page.locator('dialog[id^="add-spec-"]');
const candidate = (folder: string): Locator => dialog().locator(`input[name="member"][value="${folder}"]`);

/** The Jobs tab of a board with a group of two and one spec in no group, in a specs repository that can save. */
async function openCard(): Promise<void> {
  const { base, dir } = harness.start({
    description: grouped(FIRST, 1),
    alsoSpecs: [SECOND, ADDED],
    alsoDescriptions: { [SECOND]: grouped(SECOND, 2), [ADDED]: plain(ADDED) },
    executionGroups: [{
      id: "group-1", project: "aide", name: "Release", members: [FIRST, SECOND],
      branch: `aide/group-${FIRST}-release`, state: "prepared", createdAt: "2026-11-11T10:00:00Z",
      completedMembers: [], jobs: [],
    }],
  });
  makeSpecsRepo(dir);
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
  await page.getByRole("button", { name: "Release", exact: true }).click();
  await page.getByRole("button", { name: t("en", "list.groupAddSpec"), exact: true }).click();
  await dialog().waitFor({ state: "visible" });
}

test("Add spec opens a dialog listing the spec the group can take (AC-2)", async () => {
  await openCard();
  expect(await candidate(ADDED).isVisible()).toBe(true);
  expect(await candidate(FIRST).count()).toBe(0);
});

test("Add closes the dialog and the card shows the added spec last (AC-3)", async () => {
  await openCard();
  await candidate(ADDED).check();
  await dialog().getByRole("button", { name: t("en", "list.groupAddSave"), exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
  const head = card().locator("tbody[data-group-head]");
  await head.locator(`.pip[title="${ADDED}"]`).waitFor({ state: "attached" });
  expect(await head.locator(".pip").count()).toBe(3);
});
