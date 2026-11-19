import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { createdJob, queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();
const harness = queueHarness("aide-e2e-state-menu-open-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  base = harness.start({ queueMirror: JSON.stringify([createdJob()]) }).base;
});

afterAll(async () => { await browser.close(); harness.cleanup(); });

test("state and type keep independent multiple selections and their menus stay open (AC-2)", async () => {
  await withBrowser(page.goto(`${base}/?live=0&state=all`), "page.goto(/)");
  const menu = page.locator('details.menu[data-filter="state"]');
  await menu.locator("summary").click();
  expect(await page.locator("#spec-aide\\/81-queue-and-runner").count()).toBe(1);

  const all = menu.getByRole("checkbox", { name: /^All \(/ });
  const none = menu.getByRole("checkbox", { name: "None", exact: true });
  const failed = menu.getByRole("checkbox", { name: /^Failed \(/ });
  expect(await failed.getAttribute("aria-checked")).toBe("true");
  await none.click();
  await page.waitForURL((url) => url.searchParams.get("state") === "none");
  await menu.getByRole("checkbox", { name: /^Failed \(/, checked: false }).waitFor();
  expect(await none.getAttribute("aria-checked")).toBe("true");
  await all.click();
  await page.waitForURL((url) => url.searchParams.get("state") === "all");
  await menu.getByRole("checkbox", { name: /^Failed \(/, checked: true }).waitFor();
  await none.click();
  await menu.getByRole("checkbox", { name: "None", checked: true, exact: true }).waitFor();
  await failed.click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get("state") === "failed");
  await page.locator("#spec-aide\\/81-queue-and-runner").waitFor({ state: "detached" });
  expect(await page.locator('details.menu[data-filter="state"]').evaluate((d) => (d as HTMLDetailsElement).open)).toBe(true);

  await page.locator('details.menu[data-filter="state"] .menupanel a[href*="waiting"]').click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get("state")?.split(",").length === 2);
  expect(new Set(new URL(page.url()).searchParams.get("state")?.split(","))).toEqual(new Set(["waiting", "failed"]));

  await page.keyboard.press("Escape");
  expect(await page.locator('details.menu[data-filter="state"]').evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);

  const typeMenu = page.locator('details.menu[data-filter="kind"]');
  await typeMenu.locator("summary").click();
  await typeMenu.getByRole("checkbox", { name: "None", exact: true }).click();
  await typeMenu.getByRole("checkbox", { name: "None", checked: true, exact: true }).waitFor();
  await typeMenu.getByRole("checkbox", { name: /^Schedule/ }).click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get("kind") === "schedule");
  expect(new Set(new URL(page.url()).searchParams.get("state")?.split(","))).toEqual(new Set(["waiting", "failed"]));
  expect(await page.locator('details.menu[data-filter="kind"]').evaluate((d) => (d as HTMLDetailsElement).open)).toBe(true);

  await page.locator('details.menu[data-filter="kind"] .menupanel a[href*="spec"]').click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get("kind")?.split(",").length === 2);
  expect(new Set(new URL(page.url()).searchParams.get("kind")?.split(","))).toEqual(new Set(["spec", "schedule"]));
});

test("Specs can clear the selection and restore all results without leaving the menu", async () => {
  await page.goto(`${base}/specs?live=0&state=all`);
  const menu = page.locator('details.menu[data-filter="state"]');
  await menu.locator("summary").click();
  const spec = page.locator('tr.spechead[data-folder="81-queue-and-runner"]');
  await spec.waitFor();
  await menu.getByRole("checkbox", { name: "None", exact: true }).click();
  await menu.getByRole("checkbox", { name: "None", exact: true, checked: true }).waitFor();
  await spec.waitFor({ state: "detached" });
  await menu.getByRole("checkbox", { name: /^All \(/ }).click();
  await menu.getByRole("checkbox", { name: /^Archived \(/, checked: true }).waitFor();
  await spec.waitFor();
});
