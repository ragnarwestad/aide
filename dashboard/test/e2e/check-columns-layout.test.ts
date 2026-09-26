// An acceptance criterion's two boxes and the heading over them, in a real
// browser. The unit tests prove the markup, the names and the route; where the
// columns sit, what a real click clears and saves, when the archived note shows
// and how it behaves at a phone's width are questions only a browser answers.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../helpers/queue-server.ts";
import { phaseSection, PHASE, recording } from "../spec-page/spec-checks-fixtures.ts";

browserDeadline();
const LIVE = "81-queue-and-runner";
const ARCHIVED = "150-the-archived-one";
const LONG = `AC-2: ${"a criterion that keeps going and going ".repeat(5)}`.trim();
const LIVE_ONE = "| AC-1: it folds | ✅ | |";
const LIVE_TWO = `| ${LONG} | ⬜ | a note under the criterion |`;
const LIVE_STATUS = [
  "# Queue - Status", "", "## Tracking info", "",
  "- **Workflow steps completed:** analyze, implement", "",
  "## Acceptance criteria", "",
  "| Task | Status | Notes |", "|------|--------|-------|",
  LIVE_ONE, LIVE_TWO, "",
].join("\n");
const LIVE_STATE = JSON.stringify({
  completedPhases: ["analyze", "implement"], archived: null, reopened: null, phaseCounts: {},
  acceptanceCriteria: [{ task: "AC-1: it folds", done: true }, { task: LONG, done: false }],
});
const DONE = "| AC-1: it was ticked | ✅ | |";
const NV = `| ${LONG} | Not verified | Not tested: needs production |`;
const FAILED = "| AC-3: it failed | ❌ Failed | Failed: it did not hold |";
const ARCHIVED_STATUS = [
  "# Queue - Status", "", "## Tracking info", "",
  "- **Workflow steps completed:** create, analyze, implement, archive", "- **Archived:** `2026-09-01`", "",
  phaseSection(PHASE, [DONE, NV, FAILED]),
].join("\n");
const ARCHIVED_STATE = JSON.stringify({
  completedPhases: ["create", "analyze", "implement", "archive"], archived: "2026-09-01", reopened: null, phaseCounts: {},
  acceptanceCriteria: [
    { task: "AC-1: it was ticked", done: true },
    { task: LONG, done: true, notVerified: true },
    { task: "AC-3: it failed", done: false, failed: true },
  ],
});

const harness = queueHarness("aide-e2e-check-columns-");
let browser: Browser;
let page: Page;
let base: string;
let dir: string;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  const started = harness.start({
    extra: { gitRun: recording().run },
    status: LIVE_STATUS,
    archivedSpecs: { [ARCHIVED]: { status: ARCHIVED_STATUS, state: ARCHIVED_STATE } },
  });
  base = started.base;
  dir = started.dir;
  writeFileSync(join(dir, "root", "aide", "specs", LIVE, "4-status.json"), LIVE_STATE);
  ran(dir, ["analyze", "implement"]);
  // The list draws the live spec's criteria only once its freshness check has
  // verified "implement" against git history, which the list reaches by its
  // own poll.
  const deadline = Date.now() + 10_000;
  while (!(await (await fetch(`${base}/?live=0`)).text()).includes("tick them under › on the Specs list, or on the Status tab")) {
    if (Date.now() > deadline) throw new Error("the specs list never carried the acceptance hold-back message");
    await new Promise((r) => setTimeout(r, 50));
  }
});
afterAll(async () => { await browser.close(); harness.cleanup(); });

type Box = { left: number; top: number; right: number; bottom: number; width: number };
const box = (sel: string) =>
  page.evaluate((s): Box => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width };
  }, sel);

/** Both lists of each spec: the Status tab, and the list unfolded under the ›. */
const LISTS = [
  { name: "the live Status tab", root: "section.checks", open: (w: number) => status(LIVE, w) },
  { name: "the live Specs list", root: ".rowchecks", open: (w: number) => unfolded(LIVE, w) },
  { name: "the archived Status tab", root: "section.checks", open: (w: number) => status(ARCHIVED, w) },
  { name: "the archived Specs list", root: ".rowchecks", open: (w: number) => unfolded(ARCHIVED, w) },
];
async function status(folder: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${base}/specs/aide/${folder}?tab=status&live=0`);
  await page.waitForSelector("section.checks .check");
}
async function unfolded(folder: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${base}/?live=0&checks=aide%2F${folder}`);
  await page.waitForSelector(`tr.specnotice[data-folder="${folder}"] .rowchecks .check`);
}
const BOXROW = ".check:has(.checkbox input)";

describe("the text at the left, the two boxes at the right, in a shared pair of columns (AC-1)", () => {
  for (const list of LISTS) {
    test(`${list.name} at 1100px`, async () => {
      await list.open(1100);
      const rows = await page.locator(`${list.root} ${BOXROW}`).count();
      expect(rows).toBeGreaterThan(0);
      const lefts: number[][] = [];
      for (let i = 0; i < rows; i++) {
        const r = await page.evaluate(([root, sel, n]) => {
          const el = document.querySelectorAll(`${root} ${sel}`)[n as number]!;
          const rect = (e: Element) => e.getBoundingClientRect();
          const [first, second] = [...el.querySelectorAll("label.checkbox")];
          const text = rect(el.querySelector(".checktask")!);
          return { textRight: text.right, textTop: text.top, a: rect(first!), b: rect(second!), row: rect(el) };
        }, [list.root, BOXROW, i]);
        expect(r.textRight).toBeLessThanOrEqual(r.a.left);
        expect(r.a.right).toBeLessThanOrEqual(r.b.left + 1);
        expect(Math.abs(r.a.top - r.b.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(r.a.top - r.textTop)).toBeLessThanOrEqual(8);
        lefts.push([r.a.left + r.a.width / 2, r.b.left + r.b.width / 2]);
      }
      for (const l of lefts) {
        expect(Math.abs(l[0]! - lefts[0]![0]!)).toBeLessThanOrEqual(1);
        expect(Math.abs(l[1]! - lefts[0]![1]!)).toBeLessThanOrEqual(1);
      }
    });
  }

  test("a read-only mark sits in the same columns as the boxes (AC-1)", async () => {
    await unfolded(ARCHIVED, 1100);
    const at = (sel: string) => box(`.rowchecks ${sel}`);
    const centre = (b: Box) => b.left + b.width / 2;
    const waiting = await page.evaluate(() => {
      const [a, b] = [...document.querySelectorAll(".rowchecks .check:has(.failcontrol) label.checkbox")]
        .map((e) => e.getBoundingClientRect());
      return { a: a!.left + a!.width / 2, b: b!.left + b!.width / 2 };
    });
    const done = await at(".check.done .checkbox");
    const failed = await at(".check.failed .unverified");
    expect(Math.abs(centre(done) - waiting.a)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre(failed) - waiting.b)).toBeLessThanOrEqual(1);
  });
});

describe("the heading over the columns (AC-2)", () => {
  for (const list of LISTS) {
    test(`${list.name}: Verified over both, Yes and the second name each over their own column`, async () => {
      await list.open(1100);
      const h = `${list.root} .checkcolumns`;
      expect(await page.locator(h).count()).toBe(1);
      const centre = (b: Box) => b.left + b.width / 2;
      const [verified, yes, other] = [await box(`${h} .checkverified`), await box(`${h} .checkyes`), await box(`${h} .checkother`)];
      const boxes = await page.evaluate((s) => {
        const [a, b] = [...document.querySelectorAll(`${s} .check:has(.checkbox input) label.checkbox`)].slice(0, 2).map((e) => e.getBoundingClientRect());
        return { a: a!.left + a!.width / 2, b: b!.left + b!.width / 2 };
      }, list.root);
      expect(Math.abs(centre(yes) - boxes.a)).toBeLessThanOrEqual(1);
      expect(Math.abs(centre(other) - boxes.b)).toBeLessThanOrEqual(1);
      expect(Math.abs(centre(verified) - (yes.left + other.right) / 2)).toBeLessThanOrEqual(1);
      expect(yes.top).toBeGreaterThanOrEqual(verified.bottom - 1);
      expect(other.top).toBeGreaterThanOrEqual(verified.bottom - 1);
      expect(await page.locator(`${h} .checkother`).textContent()).toBe(list.name.includes("archived") ? "Failed" : "Not yet");
    });
  }
});

describe("the boxes save as they did, and one clears the other (AC-3)", () => {
  test("on the Specs list, ticking Not yet clears Yes, and ticking Yes over it clears Not yet", async () => {
    await unfolded(LIVE, 1100);
    const yes = page.locator(`.rowchecks input[name="tick"][value="${LIVE_ONE}"]`);
    const notYet = page.locator(`.rowchecks input[name="unverified"][value="${LIVE_ONE}"]`);
    expect(await yes.isChecked()).toBe(true);
    await notYet.check();
    expect(await yes.isChecked()).toBe(false);
    await yes.check();
    expect(await notYet.isChecked()).toBe(false);
  });

  test("on the Status tab, ticking Not yet on a done row and pressing Save stores it as Not verified", async () => {
    await status(LIVE, 1100);
    await page.locator(`input[name="unverified"][value="${LIVE_ONE}"]`).check();
    await Promise.all([page.waitForEvent("load"), page.locator("form.specform button[type=\"submit\"]").click()]);
    const file = readFileSync(join(dir, "root", "aide", "specs", LIVE, "4-status.md"), "utf-8");
    expect(file).toContain("| AC-1: it folds | Not verified |");
  });
});

describe("the archived note shows while Failed is ticked, and is bounded at 500 (AC-4)", () => {
  test("hidden while Failed is clear, under the text's left edge once ticked, hidden again once cleared", async () => {
    await unfolded(ARCHIVED, 1100);
    const failed = page.locator(`.rowchecks input[name="failed"]`);
    const note = page.locator(".rowchecks .failnote");
    expect(await note.isVisible()).toBe(false);
    await failed.check();
    expect(await note.isVisible()).toBe(true);
    const text = await box(".rowchecks .check:has(.failcontrol) .checktask");
    const field = await box(".rowchecks .failnote");
    expect(field.top).toBeGreaterThanOrEqual(text.bottom);
    expect(Math.abs(field.left - text.left)).toBeLessThanOrEqual(1);
    await failed.uncheck();
    expect(await note.isVisible()).toBe(false);
  });

  test("600 typed characters stop at 500 and the count says so", async () => {
    await unfolded(ARCHIVED, 1100);
    await page.locator(`.rowchecks input[name="failed"]`).check();
    const field = page.locator(".rowchecks .failnote");
    await field.click();
    await page.keyboard.type("a".repeat(600), { delay: 0 });
    expect((await field.inputValue()).length).toBe(500);
    expect(await field.evaluate((el) => el.nextElementSibling!.textContent)).toBe("500 of 500 characters, 0 left");
  });

  test("five lines to begin with, at most ten when dragged as tall as it can go", async () => {
    await unfolded(ARCHIVED, 1100);
    await page.locator(`.rowchecks input[name="failed"]`).check();
    const heights = await page.evaluate(() => {
      const el = document.querySelector(".rowchecks .failnote") as HTMLTextAreaElement;
      const cs = getComputedStyle(el);
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const line = parseFloat(cs.lineHeight);
      const first = el.clientHeight - pad;
      el.style.height = "2000px";
      return { line, first, grown: el.clientHeight - pad };
    });
    expect(Math.abs(heights.first - 5 * heights.line)).toBeLessThanOrEqual(2);
    expect(heights.grown).toBeLessThanOrEqual(10 * heights.line + 1);
    expect(heights.grown).toBeGreaterThan(5 * heights.line);
  });
});

describe("at a phone's width the boxes and their heading stay at the right (AC-5)", () => {
  for (const list of LISTS) {
    test(`${list.name} at 375px`, async () => {
      await list.open(375);
      const row = await page.evaluate(([root, sel]) => {
        const el = document.querySelector(`${root} ${sel}`)!;
        const text = el.querySelector(".checktask")!.getBoundingClientRect();
        const [a, b] = [...el.querySelectorAll("label.checkbox")].map((e) => e.getBoundingClientRect());
        const head = document.querySelector(`${root} .checkcolumns .checkverified`)!.getBoundingClientRect();
        return { text: { right: text.right, top: text.top }, a: a!, b: b!, head: { left: head.left, right: head.right } };
      }, [list.root, BOXROW]);
      expect(row.text.right).toBeLessThanOrEqual(row.a.left);
      expect(Math.abs(row.a.top - row.text.top)).toBeLessThanOrEqual(8);
      expect(row.head.left).toBeGreaterThanOrEqual(row.text.right - 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }

  test("an archived row with Failed ticked has its note under the text", async () => {
    await unfolded(ARCHIVED, 375);
    await page.locator(`.rowchecks input[name="failed"]`).check();
    const text = await box(".rowchecks .check:has(.failcontrol) .checktask");
    const field = await box(".rowchecks .failnote");
    expect(field.top).toBeGreaterThanOrEqual(text.bottom);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
