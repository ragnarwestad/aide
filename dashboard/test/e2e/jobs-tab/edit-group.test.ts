// Edit on a group's card: the shared menu opens and closes like the header's,
// and Edit saves the filled member list.

import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";
import { makeSpecsRepo } from "../../helpers/specs-repo.ts";
import { t } from "../../../src/i18n";

browserDeadline();

const harness = queueHarness("aide-e2e-edit-group-");
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
const dialog = (): Locator => page.locator('dialog[id^="edit-group-"]');
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
  await card().locator("summary").click();
  await page.getByRole("button", { name: t("en", "list.groupEdit"), exact: true }).click();
  await dialog().waitFor({ state: "visible" });
}

test("the group menu closes outside and on Escape (AC-1)", async () => {
  await openCard();
  await dialog().getByRole("button", { name: "Cancel" }).click();
  await card().locator("summary").click();
  expect(await card().locator("details.menu").getAttribute("open")).not.toBeNull();
  await page.locator("main").click({ position: { x: 4, y: 4 } });
  expect(await card().locator("details.menu").getAttribute("open")).toBeNull();
  await card().locator("summary").click();
  await page.keyboard.press("Escape");
  expect(await card().locator("details.menu").getAttribute("open")).toBeNull();
});

test("Edit opens a filled dialog listing the spec the group can take (AC-3, AC-6)", async () => {
  await openCard();
  expect(await candidate(ADDED).isVisible()).toBe(true);
  expect(await candidate(FIRST).isChecked()).toBe(true);
});

test("Edit removes one member and adds another (AC-8)", async () => {
  await openCard();
  await candidate(SECOND).uncheck();
  await candidate(ADDED).check();
  await dialog().getByRole("button", { name: "Save", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
  const head = card().locator("tbody[data-group-head]");
  await head.locator(`.pip[title="${ADDED}"]`).waitFor({ state: "attached" });
  expect(await head.locator(`.pip[title="${SECOND}"]`).count()).toBe(0);
});

for (const width of [390, 1440]) {
test(`at ${width}px Remove covers the pending request and removes the group without a reload`, async () => {
  await page.setViewportSize({ width, height: 900 });
  const { base } = harness.start({
    description: grouped(FIRST, 1), alsoSpecs: [SECOND],
    alsoDescriptions: { [SECOND]: grouped(SECOND, 2) },
    executionGroups: [{ id: "group-1", project: "aide", name: "Release", members: [FIRST, SECOND],
      branch: `aide/group-${FIRST}`, state: "completed", createdAt: "2026-11-11T10:00:00Z",
      completedMembers: [FIRST, SECOND], jobs: [] }],
  });
  await page.goto(`${base}/?live=0`);
  let navigations = 0;
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations += 1; });
  await card().locator("summary").click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  const ask = page.locator("dialog.progressdialog[open]");
  await ask.waitFor({ state: "visible", timeout: 2000 });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/queue/groups/group-1/action", async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await ask.getByRole("button", { name: "OK", exact: true }).click();
    await page.locator("dialog.pageoverlay[open]").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    expect(await page.locator("dialog.pageoverlay[open]").count()).toBe(1);
  } finally { release(); }
  await card().waitFor({ state: "detached" });
  await page.locator("dialog.pageoverlay[open]").waitFor({ state: "detached" });
  expect(navigations).toBe(0);
});
}
