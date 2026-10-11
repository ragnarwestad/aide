// Opening a row loads the spec's own address, so the browser's history is
// what shuts it again. Pressing the chevron, a tab inside the row and Back
// only a browser answers.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-fold-one-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
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

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

const fold = (folder: string) => `tr.spechead[data-folder="${folder}"] a.fold`;
const detail = (key: string) => `tr[data-spec-detail="aide/${key}"]`;

const openRows = () =>
  page.evaluate(() => [...document.querySelectorAll("tr.spechead a.fold[aria-expanded=true]")].map((a) => a.closest("tr")!.getAttribute("data-folder")));

test("a chevron opens the spec at its own address, one row at a time, and Back shuts it (AC-3, AC-4)", async () => {
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

  for (let i = 0; i < 3; i++) await page.goBack();
  await page.waitForURL((url) => url.pathname === "/specs");
  expect(await openRows()).toEqual([]);
  expect(await page.$("tr[data-spec-detail]")).toBeNull();
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

// A model picked in the open row's phase table is saved for the spec the
// moment it is made, as the Running tab saves one, and leaves the settings'
// Save beside it alone.
test("a model picked in the open row is saved for the spec, and Save stays inactive", async () => {
  const picker = await browser.newPage();
  await withBrowser(picker.goto(`${base}/specs/aide/81-queue-and-runner?live=0`), "page.goto(spec)");
  const select = `${detail("81-queue-and-runner")} tr[data-step="analyze"] select[name="model.analyze"]`;
  await picker.waitForSelector(select);
  const posted = picker.waitForRequest((r) => r.url().endsWith("/api/queue/specs/aide/81-queue-and-runner/model"));
  await picker.selectOption(select, "fable");
  const body = new URLSearchParams((await posted).postData() ?? "");
  expect([body.get("step"), body.get("model")]).toEqual(["analyze", "fable"]);
  expect(await picker.isDisabled("#trackingform-save")).toBe(true);
  await picker.close();
});
