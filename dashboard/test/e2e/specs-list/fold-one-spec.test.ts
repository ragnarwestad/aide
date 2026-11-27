// Opening a row pushes the spec's own address and draws the spec in its row, so
// the browser's history is what shuts it again. Pressing the chevron, a tab
// inside the row and Back only a browser answers.
import { expect, test } from "bun:test";
import type { Browser, Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { e2eBrowser } from "../../helpers/setup/e2e-browser.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-fold-one-");
let browser: Browser;
let page: Page;
let base: string;

e2eBrowser(harness, async (launched) => {
  browser = launched;
  page = await browser.newPage();
  // Model choices, so the open row's phase table draws its pickers.
  const queueDefaults = {
    timeoutSec: { default: 1200 },
    permissionMode: { default: "acceptEdits" },
    model: { default: "sonnet" },
    modelChoices: { sonnet: {}, fable: {} },
  };
  base = harness.start({ extra: { queueDefaults }, alsoSpecs: ["82-second", "83-third"] }).base;
});

const fold = (folder: string) => `tr.spechead[data-folder="${folder}"] a.fold`;
const detail = (key: string) => `tr[data-spec-detail="aide/${key}"]`;

const openRows = () =>
  page.evaluate(() => [...document.querySelectorAll("tr.spechead a.fold[aria-expanded=true]")].map((a) => a.closest("tr")!.getAttribute("data-folder")));

test("a chevron opens the spec at its own address, one row at a time, and Back shuts it", async () => {
  await withBrowser(page.goto(`${base}/specs?live=0`), "page.goto(/specs)");
  expect(await openRows()).toEqual([]);

  await page.click(fold("81-queue-and-runner"));
  await page.waitForSelector(detail("81-queue-and-runner"));
  expect(new URL(page.url()).pathname).toBe("/specs/aide/81-queue-and-runner");
  expect(await openRows()).toEqual(["81-queue-and-runner"]);

  await page.click(`${detail("81-queue-and-runner")} a.tab:text-is("Analysis")`);
  await page.waitForURL(/tab=analysis/);
  await page.waitForSelector(detail("81-queue-and-runner"));
  expect(await openRows()).toEqual(["81-queue-and-runner"]);

  await page.click(fold("82-second"));
  await page.waitForSelector(detail("82-second"));
  expect(new URL(page.url()).pathname).toBe("/specs/aide/82-second");
  expect(await openRows()).toEqual(["82-second"]);
  expect(await page.$(detail("81-queue-and-runner"))).toBeNull();

  // The first Back puts the tab's page in place; the other two leave it.
  await page.goBack();
  await page.waitForURL(/tab=analysis/);
  for (let i = 0; i < 2; i++) await page.goBack();
  await page.waitForURL((url) => url.pathname === "/specs");
  expect(await openRows()).toEqual([]);
  await page.locator("tr[data-spec-detail]").waitFor({ state: "detached" });
});

// The description's editor sits under the row and the spec's settings, and
// grows with its text: taking focus as it mounts scrolled the page down to
// it, leaving the row that was opened above the top of the screen.
test("opening a spec leaves its row in view once the editor has mounted", async () => {
  const small = await browser.newPage({ viewport: { width: 1280, height: 560 } });
  await withBrowser(small.goto(`${base}/specs/aide/81-queue-and-runner?live=0`), "page.goto(spec)");
  await small.waitForSelector(`${detail("81-queue-and-runner")} .spec-editor-mount[data-mounted]`);
  await small.waitForTimeout(200);
  // The list scrolls inside its own box, under headings that stay put: the
  // row is in view when the headings are, and it starts below them.
  const { row, headings } = await small.evaluate(() => ({
    row: document.getElementById("spec-aide/81-queue-and-runner")!.getBoundingClientRect().top,
    headings: document.querySelector("table.speclist thead")!.getBoundingClientRect().bottom,
  }));
  expect(headings).toBeGreaterThanOrEqual(0);
  expect(row).toBeGreaterThanOrEqual(headings - 1);
  expect(row).toBeLessThan(560);
  await small.close();
});

// Opening a spec by its address — the Running tab's link to it — scrolls
// the list's own box to its row and leaves the page where it is: the
// browser's own jump to the anchor scrolled the page too, and a row far
// down a long list took the tabs and the headings above the screen.
test("a spec opened by its address far down a long list keeps the page's top in view", async () => {
  const many = queueHarness("aide-e2e-fold-long-");
  const folders = Array.from({ length: 40 }, (_, i) => `${100 + i}-spec-number-${i}`);
  const longBase = many.start({ extra: {}, alsoSpecs: folders }).base;
  const tall = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    const last = folders[0]!;
    await withBrowser(tall.goto(`${longBase}/specs/aide/${last}?live=0#spec-aide/${last}`), "page.goto(long list)");
    await tall.waitForSelector(detail(last));
    await tall.waitForTimeout(300);
    const at = await tall.evaluate((id) => ({
      page: window.scrollY,
      row: document.getElementById(id)!.getBoundingClientRect().top,
      headings: document.querySelector("table.speclist thead")!.getBoundingClientRect().bottom,
    }), `spec-aide/${last}`);
    expect(at.page).toBe(0);
    expect(at.row).toBeGreaterThanOrEqual(at.headings - 1);
    expect(at.row).toBeLessThan(900);
  } finally {
    await tall.close();
    many.cleanup();
  }
});

// A press on a shut chevron opens the row where it is: the page stays, the
// row says it is loading, and nothing else on the page answers a press until
// the spec is in. The spec's request is held with `page.route` so the wait can
// be looked at.
const isDetail = (url: URL) => url.searchParams.has("detail");

/** Holds the spec's request until the test releases it. */
async function holdDetail(p: Page): Promise<{ release: () => void }> {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await p.route(isDetail, async (route) => {
    await gate;
    await route.continue();
  });
  return { release };
}

/** A press where the element sits on the screen, which an inert page ignores; a plain click would wait for it. */
async function pressAt(p: Page, selector: string): Promise<void> {
  const box = (await p.locator(selector).first().boundingBox())!;
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test("a press anywhere else does nothing while the row loads", async () => {
  const p = await browser.newPage();
  await withBrowser(p.goto(`${base}/specs?live=0`), "page.goto(/specs)");
  const { release } = await holdDetail(p);
  const asked = p.waitForRequest((r) => isDetail(new URL(r.url())));
  await p.click(fold("81-queue-and-runner"));
  await asked;
  await p.waitForSelector(detail("81-queue-and-runner"));
  const address = p.url();
  const requests: string[] = [];
  p.on("request", (r) => requests.push(r.url()));
  await pressAt(p, "th a.sortlink");
  await pressAt(p, fold("82-second"));
  await p.waitForTimeout(300);
  expect([p.url(), requests]).toEqual([address, []]);
  release();
  await p.waitForSelector(`${detail("81-queue-and-runner")} .spec-editor-mount[data-mounted]`);
  await p.close();
});

test("a spec opened in place mounts one editor", async () => {
  const p = await browser.newPage();
  await withBrowser(p.goto(`${base}/specs?live=0`), "page.goto(/specs)");
  const asked = p.waitForRequest((r) => isDetail(new URL(r.url())));
  await p.click(fold("81-queue-and-runner"));
  await asked;
  await p.waitForSelector(`${detail("81-queue-and-runner")} .spec-editor-mount[data-mounted]`);
  expect(await p.locator(`${detail("81-queue-and-runner")} .spec-editor-mount`).count()).toBe(1);
  await p.close();
});

test("opening a second spec in place keeps its row where it was pressed, with one editor in its row", async () => {
  const many = queueHarness("aide-e2e-fold-place-");
  const folders = Array.from({ length: 12 }, (_, i) => `${100 + i}-spec-number-${i}`);
  const longBase = many.start({ extra: {}, alsoSpecs: folders }).base;
  const p = await browser.newPage({ viewport: { width: 1280, height: 500 } });
  try {
    await withBrowser(p.goto(`${longBase}/specs?live=0`), "page.goto(/specs)");
    const [first, , third] = await p.evaluate(() =>
      [...document.querySelectorAll("tr.spechead")].map((r) => r.getAttribute("data-folder")!),
    );
    await p.click(fold(first!));
    await p.waitForSelector(`${detail(first!)} .spec-editor-mount[data-mounted]`);
    await p.locator(fold(third!)).scrollIntoViewIfNeeded();
    const top = () => p.evaluate((id) => document.getElementById(id)!.getBoundingClientRect().top, `spec-aide/${third}`);
    const before = await top();
    await p.click(fold(third!));
    await p.waitForSelector(`${detail(third!)} .spec-editor-mount[data-mounted]`);
    await p.waitForTimeout(200);
    expect(Math.abs((await top()) - before)).toBeLessThanOrEqual(2);
    expect(await p.locator(".spec-editor-mount[data-mounted]").count()).toBe(1);
  } finally {
    await p.close();
    many.cleanup();
  }
});

test("Run from a closed spec can submit Archive without rerunning Create", async () => {
  const p = await browser.newPage();
  try {
    await p.goto(`${base}/specs?live=0`);
    const row = p.locator('tr.specstate[data-folder="81-queue-and-runner"]');
    await row.getByRole("button", { name: "Run", exact: true }).click();
    const dialog = p.getByRole("dialog");
    await dialog.getByRole("checkbox", { name: "Analyze", exact: true }).uncheck();
    await dialog.getByRole("checkbox", { name: "Implement", exact: true }).uncheck();
    await dialog.getByRole("checkbox", { name: "Archive", exact: true }).check();
    await p.route("**/api/queue", (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Captured submission" }) }));
    const sent = p.waitForRequest((r) => new URL(r.url()).pathname === "/api/queue" && r.method() === "POST");
    await dialog.getByRole("button", { name: "Run", exact: true }).click();
    const form = new URLSearchParams((await sent).postData() ?? "");
    expect(form.getAll("steps")).toEqual(["archive"]);
    expect(form.get("model.archive")).toBe("sonnet");
    expect(form.get("specFolder")).toBe("81-queue-and-runner");
  } finally { await p.close(); }
});
