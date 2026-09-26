// An open spec row drops the head row's second line: the caption line
// under it carries the spec's Time and Cost, and each phase line says
// its own state. Whether a line is really gone, and whether the caption
// line still sits in its own columns once it is, only a browser answers.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-open-row-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  const started = harness.start({ extra: {} });
  base = started.base;
  ran(started.dir, ["create", "analyze"]);
  await new Promise((r) => setTimeout(r, 400));
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

const OPEN = "open=aide%2F81-queue-and-runner";

async function measure(width: number) {
  await page.setViewportSize({ width, height: 900 });
  await withBrowser(page.goto(`${base}/?live=0&${OPEN}`), `page.goto at ${width}px`);
  return page.evaluate(() => {
    const line2 = document.querySelector("tr.specstate") as HTMLElement;
    const cap = document.querySelector('tr.subrow[data-caption="1"]')!;
    const phase = document.querySelector("tr.subrow[data-step]")!;
    const cell = (tr: Element, col: string) => tr.querySelector(`[data-col="${col}"]`) as HTMLElement;
    const visible = (el: HTMLElement) =>
      el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility === "visible";
    return {
      line2Shown: visible(line2) && getComputedStyle(line2).display !== "none",
      capTime: cell(cap, "started").textContent!.trim(),
      capCost: cell(cap, "cost").textContent!.trim(),
      // The caption line's cells stand over the phase lines' own.
      timeOverPhase: Math.abs(cell(cap, "started").getBoundingClientRect().left - cell(phase, "started").getBoundingClientRect().left),
      sideways: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

test("a desktop's open row drops its second line and the caption line carries Time and Cost, in their columns", async () => {
  const m = await measure(1270);
  expect(m.line2Shown).toBe(false);
  expect(m.capTime).not.toBe("");
  expect(m.capCost).not.toBe("");
  expect(m.timeOverPhase).toBeLessThanOrEqual(1);
  expect(m.sideways).toBeLessThanOrEqual(0);
});

test("a phone's open row drops its second line too", async () => {
  const m = await measure(390);
  expect(m.line2Shown).toBe(false);
  expect(m.sideways).toBeLessThanOrEqual(0);
});

test("a shut row keeps its second line", async () => {
  await page.setViewportSize({ width: 1270, height: 900 });
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
  const shown = await page.evaluate(() => (document.querySelector("tr.specstate") as HTMLElement).getBoundingClientRect().height > 0);
  expect(shown).toBe(true);
});
