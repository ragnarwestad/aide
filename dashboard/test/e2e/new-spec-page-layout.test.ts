// A real-browser check for the New spec page (spec 476): none of these
// cases are about a rule existing — a text-only render test cannot see
// where a popover actually lands once it opens, only that its markup is
// there. Modelled on specs-page-layout.test.ts's own harness/viewport
// pattern.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { queueHarness } from "../helpers/queue-server.ts";

setDefaultTimeout(20_000);

const TOKEN = "s3cret-token";

const harness = queueHarness("aide-e2e-new-spec-layout-");
let browser: Browser;
let page: Page;
let base: string;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} did not resolve within ${ms}ms`)), ms),
    ),
  ]);
}

beforeAll(async () => {
  browser = await withTimeout(chromium.launch(), 15_000, "chromium.launch()");
  page = await browser.newPage();
  const started = harness.start({ extra: { queueToken: TOKEN } });
  base = started.base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

// The acceptance switch's own `<label data-acceptance="1">` and the
// AI-formulate switch's `<label data-ai-formulate="1">` are each a
// sibling of the `.fieldend` that holds their own "(?)" (`phaseChip()`
// puts the `data-*` attribute on the label itself, `field()`'s
// `.fieldhead` lays label and `.fieldend` out as the two ends of one
// line) — so the adjacent-sibling combinator reaches each switch's own
// popover without depending on which order the two switches render in.
const ACCEPT_SUMMARY = 'label[data-acceptance="1"] + span.fieldend details.intro > summary';
const ACCEPT_POPOVER = 'label[data-acceptance="1"] + span.fieldend details.intro[open] p';
const FORMULATE_SUMMARY = 'label[data-ai-formulate="1"] + span.fieldend details.intro > summary';
const FORMULATE_POPOVER = 'label[data-ai-formulate="1"] + span.fieldend details.intro[open] p';

function rectsIntersect(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// AC-1: the switches sit beside the phase table, not among its rows or
// on a full-width line below it.
test("AC-1: the acceptance switches' column sits beside the phase table, not below it", async () => {
  await page.setViewportSize({ width: 1270, height: 900 });
  await withTimeout(page.goto(`${base}/new?token=${TOKEN}&live=0`), 10_000, "page.goto(/new)");
  const [table, col] = await Promise.all([
    page.locator("#new-spec-form table.list").evaluate((el) => el.getBoundingClientRect()),
    page.locator(".acceptance-col").evaluate((el) => el.getBoundingClientRect()),
  ]);
  expect(col.left).toBeGreaterThanOrEqual(table.right - 1);
  // Beside it, not far below where a full-width line would have put it.
  expect(col.top).toBeLessThan(table.bottom);
});

for (const viewport of [
  // Spec 477: the 640/40rem wrap breakpoint and 1270px laptop width
  // below had no coverage between them — the width range most likely
  // to reproduce the reported overflow, since `.acceptance-col` sits
  // beside the phase table without wrapping there.
  { name: "narrow", width: 900, height: 900 },
  { name: "laptop", width: 1270, height: 900 },
  { name: "wide", width: 1920, height: 1080 },
]) {
  describe(`at ${viewport.name} width (${viewport.width}px)`, () => {
    // AC-3: each popover stays fully on screen when opened from its new
    // position beside the phase table.
    test("AC-3: the acceptance switch's popover stays within the viewport", async () => {
      await page.setViewportSize(viewport);
      await withTimeout(page.goto(`${base}/new?token=${TOKEN}&live=0`), 10_000, "page.goto(/new)");
      await page.locator(ACCEPT_SUMMARY).click();
      const rect = await page.locator(ACCEPT_POPOVER).evaluate((el) => el.getBoundingClientRect());
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(viewport.width);
      expect(rect.bottom).toBeLessThanOrEqual(viewport.height);
    });

    test("AC-3: the AI-formulate switch's popover stays within the viewport", async () => {
      await page.setViewportSize(viewport);
      await withTimeout(page.goto(`${base}/new?token=${TOKEN}&live=0`), 10_000, "page.goto(/new)");
      await page.locator(FORMULATE_SUMMARY).click();
      const rect = await page.locator(FORMULATE_POPOVER).evaluate((el) => el.getBoundingClientRect());
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(viewport.width);
      expect(rect.bottom).toBeLessThanOrEqual(viewport.height);
    });
  });
}

// AC-4: opened alone, neither popover reaches the other switch or the
// phase table.
test("AC-4: the acceptance switch's popover does not overlap the AI-formulate switch or the phase table", async () => {
  await page.setViewportSize({ width: 1270, height: 900 });
  await withTimeout(page.goto(`${base}/new?token=${TOKEN}&live=0`), 10_000, "page.goto(/new)");
  await page.locator(ACCEPT_SUMMARY).click();
  const [popover, table, formulateLabel] = await Promise.all([
    page.locator(ACCEPT_POPOVER).evaluate((el) => el.getBoundingClientRect()),
    page.locator("#new-spec-form table.list").evaluate((el) => el.getBoundingClientRect()),
    page.locator('label[data-ai-formulate="1"]').evaluate((el) => el.getBoundingClientRect()),
  ]);
  expect(rectsIntersect(popover, table)).toBe(false);
  expect(rectsIntersect(popover, formulateLabel)).toBe(false);
});

test("AC-4: the AI-formulate switch's popover does not overlap the acceptance switch or the phase table", async () => {
  await page.setViewportSize({ width: 1270, height: 900 });
  await withTimeout(page.goto(`${base}/new?token=${TOKEN}&live=0`), 10_000, "page.goto(/new)");
  await page.locator(FORMULATE_SUMMARY).click();
  const [popover, table, acceptLabel] = await Promise.all([
    page.locator(FORMULATE_POPOVER).evaluate((el) => el.getBoundingClientRect()),
    page.locator("#new-spec-form table.list").evaluate((el) => el.getBoundingClientRect()),
    page.locator('label[data-acceptance="1"]').evaluate((el) => el.getBoundingClientRect()),
  ]);
  expect(rectsIntersect(popover, table)).toBe(false);
  expect(rectsIntersect(popover, acceptLabel)).toBe(false);
});
