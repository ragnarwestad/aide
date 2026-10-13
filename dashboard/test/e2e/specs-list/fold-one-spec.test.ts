// Opening a row pushes the spec's own address and draws the spec in its row, so
// the browser's history is what shuts it again. Pressing the chevron, a tab
// inside the row and Back only a browser answers.
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

  // The first Back lands on the tab's page, which the page script loads again;
  // the other two leave the document.
  const reloaded = page.waitForEvent("load");
  await page.goBack();
  await reloaded;
  for (let i = 0; i < 2; i++) await page.goBack();
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
// moment it is made, as the Running tab saves one.
test("a model picked in the open row is saved for the spec", async () => {
  const picker = await browser.newPage();
  await withBrowser(picker.goto(`${base}/specs/aide/81-queue-and-runner?live=0`), "page.goto(spec)");
  const select = `${detail("81-queue-and-runner")} tr[data-step="analyze"] select[name="model.analyze"]`;
  await picker.waitForSelector(select);
  const posted = picker.waitForRequest((r) => r.url().endsWith("/api/queue/specs/aide/81-queue-and-runner/model"));
  await picker.selectOption(select, "fable");
  const body = new URLSearchParams((await posted).postData() ?? "");
  expect([body.get("step"), body.get("model")]).toEqual(["analyze", "fable"]);
  await picker.close();
});

// A press on a shut chevron opens the row where it is: the page stays, the
// row says it is loading, and nothing else on the page answers a press until
// the spec is in. The spec's request is held with `page.route` so the wait can
// be looked at.
const isDetail = (url: URL) => url.searchParams.has("detail");

/** Holds the spec's request until the test releases it, or fails it with a status. */
async function holdDetail(p: Page): Promise<{ release: () => void; fail: (status: number) => void }> {
  let release = (): void => {};
  let fail = (_status: number): void => {};
  const gate = new Promise<number>((resolve) => {
    release = () => resolve(0);
    fail = (status) => resolve(status);
  });
  await p.route(isDetail, async (route) => {
    const status = await gate;
    if (status) await route.fulfill({ status, body: "no" });
    else await route.continue();
  });
  return { release, fail };
}

/** A press where the element sits on the screen, which an inert page ignores; a plain click would wait for it. */
async function pressAt(p: Page, selector: string): Promise<void> {
  const box = (await p.locator(selector).first().boundingBox())!;
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test("the rest of the page stays drawn while a row loads, and Loading is only in that row (AC-1, AC-2)", async () => {
  const p = await browser.newPage();
  await withBrowser(p.goto(`${base}/specs?live=0`), "page.goto(/specs)");
  const { release } = await holdDetail(p);
  await p.evaluate(() => {
    (window as unknown as { kept: Element[] }).kept = [
      document.querySelector("table.speclist thead")!,
      document.querySelector("th a.sortlink")!,
      [...document.querySelectorAll("nav a")].find((a) => a.getBoundingClientRect().height > 0)!,
      document.getElementById("spec-aide/82-second")!,
    ];
  });
  await p.click(fold("81-queue-and-runner"));
  await p.waitForSelector(`${detail("81-queue-and-runner")}`);
  // Past the overlay's delay: a page-leaving link would be covered by now.
  await p.waitForTimeout(400);
  const seen = await p.evaluate(() => ({
    kept: (window as unknown as { kept: Element[] }).kept.map((el) => el.isConnected && el.getBoundingClientRect().height > 0),
    loading: document.body.innerText.match(/Loading …/g)?.length ?? 0,
    inRow: document.querySelector("tr[data-spec-detail]")!.textContent!.includes("Loading …"),
    overlay: document.querySelectorAll("dialog[open], .pageloading").length,
  }));
  expect(seen).toEqual({ kept: [true, true, true, true], loading: 1, inRow: true, overlay: 0 });
  release();
  await p.waitForSelector(`${detail("81-queue-and-runner")} .spec-editor-mount[data-mounted]`);
  expect(await p.evaluate(() => document.body.innerText.includes("Loading …"))).toBe(false);
  await p.close();
});

test("a press anywhere else does nothing while the row loads (AC-3)", async () => {
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

test("a spec opened in place mounts one editor and saves a model pick (AC-4)", async () => {
  const p = await browser.newPage();
  await withBrowser(p.goto(`${base}/specs?live=0`), "page.goto(/specs)");
  const asked = p.waitForRequest((r) => isDetail(new URL(r.url())));
  await p.click(fold("81-queue-and-runner"));
  await asked;
  await p.waitForSelector(`${detail("81-queue-and-runner")} .spec-editor-mount[data-mounted]`);
  const select = `${detail("81-queue-and-runner")} tr[data-step="analyze"] select[name="model.analyze"]`;
  const posted = p.waitForRequest((r) => r.url().endsWith("/api/queue/specs/aide/81-queue-and-runner/model"));
  await p.selectOption(select, "fable");
  const body = new URLSearchParams((await posted).postData() ?? "");
  expect([body.get("step"), body.get("model")]).toEqual(["analyze", "fable"]);
  await p.close();
});

test("opening a second spec in place keeps its row where it was pressed, with one editor in its row (AC-1)", async () => {
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

test("a request that fails says so in the row, and the page can be pressed again (AC-5)", async () => {
  const p = await browser.newPage();
  await withBrowser(p.goto(`${base}/specs?live=0`), "page.goto(/specs)");
  const { fail } = await holdDetail(p);
  await p.click(fold("81-queue-and-runner"));
  await p.waitForSelector(detail("81-queue-and-runner"));
  fail(500);
  await p.waitForFunction(() => document.querySelector("tr[data-spec-detail]")?.textContent?.includes("could not be loaded"));
  expect(await p.evaluate(() => document.body.innerText.includes("Loading …"))).toBe(false);
  const address = p.url();
  await p.click("th a.sortlink");
  await p.waitForFunction((was) => location.href !== was, address);
  await p.close();
});

test("Back from a spec opened in place shuts its row without loading the list again (AC-1)", async () => {
  const p = await browser.newPage();
  await withBrowser(p.goto(`${base}/specs?live=0`), "page.goto(/specs)");
  await p.evaluate(() => { (window as unknown as { sameDocument: boolean }).sameDocument = true; });
  await p.click(fold("81-queue-and-runner"));
  await p.waitForSelector(`${detail("81-queue-and-runner")} .spec-editor-mount[data-mounted]`);
  await p.goBack();
  await p.waitForURL((url) => url.pathname === "/specs");
  await p.waitForFunction(() => !document.querySelector("tr[data-spec-detail]"));
  expect(await p.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
  expect(await p.getAttribute(fold("81-queue-and-runner"), "aria-expanded")).toBe("false");
  await p.close();
});
