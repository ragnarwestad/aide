// Spec 522: the Failed control of an archived Not verified row, in a real
// browser. The unit tests prove the markup, the rules and the route; how wide
// the two halves are, where the note sits, how tall the field grows and what
// the count says after the › are questions only a browser answers.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import { queueHarness } from "../helpers/queue-server.ts";
import { phaseSection, PHASE } from "../spec-page/spec-checks-fixtures.ts";

browserDeadline();
const FOLDER = "150-the-archived-one";
const KEY = `aide%2F${FOLDER}`;
const LONG = `AC-2: ${"a criterion that keeps going and going ".repeat(5)}`.trim();
const DONE = "| AC-1: it was ticked | ✅ | |";
const NV = `| ${LONG} | Not verified | Not tested: needs production |`;
const FAILED = "| AC-3: it failed | ❌ Failed | Failed: it did not hold |";
const STATUS = [
  "# Queue - Status", "", "## Tracking info", "",
  "- **Workflow steps completed:** create, analyze, implement, archive", "- **Archived:** `2026-09-01`", "",
  phaseSection(PHASE, [DONE, NV, FAILED]),
].join("\n");
const STATE = JSON.stringify({
  completedPhases: ["create", "analyze", "implement", "archive"], archived: "2026-09-01", reopened: null, phaseCounts: {},
  acceptanceCriteria: [
    { task: "AC-1: it was ticked", done: true },
    { task: LONG, done: true, notVerified: true },
    { task: "AC-3: it failed", done: false, failed: true },
  ],
});

const harness = queueHarness("aide-e2e-failed-control-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  base = harness.start({ archivedSpecs: { [FOLDER]: { status: STATUS, state: STATE } } }).base;
});
afterAll(async () => { await browser.close(); harness.cleanup(); });

type Box = { left: number; top: number; right: number; bottom: number; width: number };
const box = (sel: string) =>
  page.evaluate((s): Box => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width };
  }, sel);
const NVROW = ".rowchecks .check:has(.failcontrol)";
const unfolded = async (width: number): Promise<void> => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${base}/?live=0&checks=${KEY}`);
  await page.waitForSelector(`${NVROW} .failcontrol`);
};

describe("the Failed control shares the row with the criterion (AC-1)", () => {
  test("the text and the control are two equal halves, the control ending at the row's edge (1100px)", async () => {
    await unfolded(1100);
    const [row, text, control] = [await box(NVROW), await box(`${NVROW} .checktask`), await box(`${NVROW} .failcontrol`)];
    expect(Math.abs(text.width - control.width)).toBeLessThanOrEqual(1);
    expect(text.width).toBeGreaterThanOrEqual(row.width * 0.45);
    expect(Math.abs(control.right - row.right)).toBeLessThanOrEqual(1);
    expect(text.right).toBeLessThanOrEqual(control.left);
  });

  test("a done row and a Failed row keep the criterion at most of the row (AC-1)", async () => {
    await unfolded(1100);
    for (const sel of [".rowchecks .check:not(:has(.failcontrol))"]) {
      const rows = await page.locator(sel).count();
      for (let i = 0; i < rows; i++) {
        const w = await page.evaluate(([s, n]) => {
          const el = document.querySelectorAll(s as string)[n as number]!;
          return [el.getBoundingClientRect().width, el.querySelector(".checktask")!.getBoundingClientRect().width];
        }, [sel, i]);
        expect(w[1]! / w[0]!).toBeGreaterThanOrEqual(0.6);
      }
    }
  });

  test("the Status tab draws the same halves (AC-1)", async () => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(`${base}/specs/aide/${FOLDER}?tab=status`);
    await page.waitForSelector(".check .failcontrol");
    const text = await box(".check:has(.failcontrol) .checktask");
    const control = await box(".check .failcontrol");
    expect(Math.abs(text.width - control.width)).toBeLessThanOrEqual(1);
  });
});

describe("the note has a line of its own (AC-2)", () => {
  for (const width of [1100, 375]) {
    test(`the field sits under the Failed box, left edges level (${width}px)`, async () => {
      await unfolded(width);
      const label = await box(`${NVROW} .failcontrol label`);
      const field = await box(`${NVROW} .failnote`);
      expect(field.top).toBeGreaterThanOrEqual(label.bottom);
      expect(Math.abs(field.left - label.left)).toBeLessThanOrEqual(1);
    });
  }
});

describe("the note is a text area of five to ten lines (AC-3)", () => {
  test("five lines to begin with, at most ten when dragged as tall as it can go", async () => {
    await unfolded(1100);
    const heights = await page.evaluate((s) => {
      const el = document.querySelector(s) as HTMLTextAreaElement;
      const cs = getComputedStyle(el);
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const line = parseFloat(cs.lineHeight);
      const content = () => el.clientHeight - pad;
      const first = content();
      el.style.height = "2000px";
      return { line, first, grown: content() };
    }, `${NVROW} .failnote`);
    expect(Math.abs(heights.first - 5 * heights.line)).toBeLessThanOrEqual(2);
    expect(heights.grown).toBeLessThanOrEqual(10 * heights.line + 1);
    expect(heights.grown).toBeGreaterThan(5 * heights.line);
  });
});

describe("the note is bounded at 500 (AC-4)", () => {
  test("after the › unfolds the list, 600 typed characters stop at 500 and the count says so", async () => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(`${base}/?live=0`);
    await page.locator(`tr.specnotice[data-folder="${FOLDER}"] a.fold`).click();
    const field = page.locator(`${NVROW} .failnote`);
    await field.waitFor();
    await field.click();
    await page.keyboard.type("a".repeat(600), { delay: 0 });
    expect((await field.inputValue()).length).toBe(500);
    expect(await field.evaluate((el) => el.nextElementSibling!.textContent)).toBe("500 of 500 characters, 0 left");
  });
});

describe("below the phone threshold the control stacks (AC-5)", () => {
  for (const width of [375, 640]) {
    test(`at ${width}px the control sits under the criterion, each most of the row`, async () => {
      await unfolded(width);
      const [row, text, control] = [await box(NVROW), await box(`${NVROW} .checktask`), await box(`${NVROW} .failcontrol`)];
      expect(control.top).toBeGreaterThanOrEqual(text.bottom);
      expect(text.width).toBeGreaterThanOrEqual(row.width * 0.75);
      expect(control.width).toBeGreaterThanOrEqual(row.width * 0.75);
    });
  }

  test("at 641px they sit side by side again", async () => {
    await unfolded(641);
    const [text, control] = [await box(`${NVROW} .checktask`), await box(`${NVROW} .failcontrol`)];
    expect(control.top).toBeLessThan(text.bottom);
  });

  test("nothing scrolls sideways at 375px", async () => {
    await unfolded(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
