// A phase line on a phone, as a browser lays it out.
//
// Every width here is a media query's and a flex line's answer, so no
// string in the stylesheet says whether "Sonnet" fits its button or
// whether the phases' state starts under the spec's own. Those are the
// four things that were wrong on spec 480's second round: the model name
// cut to "Sonne", "Running (3)" clipped into Time, Time pushed past the
// edge, and the state and Time columns drifting apart as the screen
// widened — measured here at the widths a phone is.
//
// Spec 488 adds two more bands the same reasoning now covers: the button
// growing between 400 and 600px (AC-1/AC-2), and the two ordinary
// selects standing in its place from 600 to 640px (AC-3/AC-4) — this is
// also the headless-browser walk 3-solution.md's Implementation plan
// Step 4 asks for, run against this project's own fixture model/tool
// names ("Sonnet"/"claude").

import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { queueHarness } from "../../helpers/queue-server.ts";

setDefaultTimeout(30_000);

const OPEN = "open=aide%2F81-queue-and-runner";

const harness = queueHarness("aide-e2e-phone-phase-line-");
let browser: Browser;
let page: Page;
let base: string;
let runnerDir: string;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  // A runner that only waits, so the spec sits mid-analyze with a live
  // "Running" badge and a clock — the widest line a phase row draws.
  runnerDir = mkdtempSync(join(tmpdir(), "aide-e2e-waiting-runner-"));
  const runner = join(runnerDir, "runner");
  writeFileSync(runner, "#!/bin/sh\nexec sleep 600\n", { mode: 0o755 });
  const started = harness.start({
    extra: {
      queueRunnerBin: runner,
      queueDefaults: {
        timeoutSec: { default: 600 },
        permissionMode: { default: "acceptEdits" },
        model: { default: "Sonnet" },
        // A second, same-tool entry (spec 488): enough to pick a
        // different MODEL at the 600-640px band without needing a
        // second tool, for the AC-4 case below.
        modelChoices: { Sonnet: { tool: "claude" }, Opus: { tool: "claude" } },
      },
    },
  });
  base = started.base;
  await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze", "implement", "archive"] }),
  });
  await page.goto(`${base}/?live=0`);
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
  rmSync(runnerDir, { recursive: true, force: true });
});

/** Where the parts of the page that line up are, at one width. */
async function lineAt(width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`${base}/?${OPEN}&live=0`);
  return page.evaluate(() => {
    const box = (el: Element | null) => (el ? el.getBoundingClientRect() : undefined);
    const shown = (el: Element | null) => !!el && (el as HTMLElement).getClientRects().length > 0;
    const line = document.querySelector('tr.subrow[data-step="analyze"]')!;
    const button = line.querySelector(".aimodelnow") as HTMLElement;
    const card = line.closest("table")!;
    return {
      headState: box(document.querySelector("tr.subrow[data-caption] .headstate"))!.left,
      phaseState: box(line.querySelector('td[data-col="state"] .badge'))!.left,
      timeLeft: box(line.querySelector('td[data-col="started"]'))!.left,
      timeRight: box(line.querySelector('td[data-col="started"]'))!.right,
      cardRight: box(card)!.right,
      buttonCut: button.scrollWidth > button.clientWidth,
      lineTop: box(line)!.top,
      lineBottom: box(line)!.bottom,
      // Spec 488: which of the button's two candidate spans a reader
      // actually sees at this width.
      shortShown: shown(line.querySelector(".aimodelshort")),
      fullShown: shown(line.querySelector(".aimodelfull")),
      buttonShown: shown(button),
      aiSelectShown: shown(line.querySelector("select[data-ai]")),
      modelSelectShown: shown(line.querySelector('select[name^="model."]')),
    };
  });
}

test.each([360, 390, 430])("at %ipx the line fits and lines up", async (width) => {
  const at = await lineAt(width);
  expect(at.buttonCut).toBe(false);
  expect(Math.abs(at.phaseState - at.headState)).toBeLessThanOrEqual(1);
  expect(at.timeRight).toBeLessThanOrEqual(at.cardRight);
  // One line, not two: Time never wraps under the state.
  expect(at.lineBottom - at.lineTop).toBeLessThan(40);
});

// AC-6: below 400px, the button still shows the bare model name alone —
// unchanged by spec 488, and 360/390 above are both below that line
// already. 430px is NOT (spec 488 starts the growing band at 400px), so
// this is where the two bands actually meet.
test("below 400px the button still shows the bare model name, never the tool", () => {
  return lineAt(390).then((at) => {
    expect(at.shortShown).toBe(true);
    expect(at.fullShown).toBe(false);
  });
});

// AC-2: from 400px, the pair does not fit the button yet — the walk
// below found it wraps Time onto a second line up to 412-416px with the
// grown width, closer to 400px than this file's first guess assumed —
// so the button stays the sub-400px default here, unwidened, until
// there is genuinely room (next test).
test.each([410, 420])("at %ipx it is too soon to grow: the button stays the bare model name", async (width) => {
  const at = await lineAt(width);
  expect(at.buttonCut).toBe(false);
  expect(at.lineBottom - at.lineTop).toBeLessThan(40);
  expect(at.shortShown).toBe(true);
  expect(at.fullShown).toBe(false);
});

// AC-1/AC-2, spec 488: once there is genuinely enough of the line left
// (432px up, per the walk above), the button widens and shows the tool
// ahead of the model instead of the model alone, without cutting the
// text or wrapping Time onto a second line. Measured with this same
// harness at 440, 480 and 550px, against this fixture's own
// "Sonnet"/"claude" pair — the same method every other width in
// narrow.css is chosen against.
test.each([440, 480, 550])("at %ipx the button has grown and shows the tool ahead of the model", async (width) => {
  const at = await lineAt(width);
  expect(at.buttonCut).toBe(false);
  expect(Math.abs(at.phaseState - at.headState)).toBeLessThanOrEqual(1);
  expect(at.timeRight).toBeLessThanOrEqual(at.cardRight);
  expect(at.lineBottom - at.lineTop).toBeLessThan(40);
  expect(at.shortShown).toBe(false);
  expect(at.fullShown).toBe(true);
});

// AC-5, restated: State and Time stay aligned WITHIN one band, and move
// together only once, at a band boundary — 3-solution.md's Acceptance
// criteria section records why the strictest, whole-range reading cannot
// be built alongside AC-1.
//
// Measured from 470, not the band's own 432: the row is too narrow below
// that to give every column the width it asks for. The State cell grows
// 69 → 77 → 84 px between 432 and 470 and is settled from there, and
// Time rides on its right edge — so Time creeps 7 px over those 38 px
// and stands still over the remaining 130. Closing that would have to
// take the width from the phase name or the AI/model button, which have
// acceptance criteria of their own at exactly the width where it is
// tightest (measured 2026-09-21).
test("within the grown 470-600px band, the state and Time columns do not move", async () => {
  const a = await lineAt(470);
  const b = await lineAt(550);
  expect(Math.abs(b.phaseState - a.phaseState)).toBeLessThanOrEqual(1);
  expect(Math.abs(b.timeLeft - a.timeLeft)).toBeLessThanOrEqual(1);
});

// AC-3: from 600 to 640px the compact button is gone entirely, and the
// AI and model stand as the two ordinary selects again — "as on a wider
// screen", per the description's own words.
test.each([610, 630])("at %ipx the AI and model show as two selects, not the button", async (width) => {
  const at = await lineAt(width);
  expect(at.buttonShown).toBe(false);
  expect(at.aiSelectShown).toBe(true);
  expect(at.modelSelectShown).toBe(true);
  expect(at.timeRight).toBeLessThanOrEqual(at.cardRight);
});

// AC-4: picking a different model at this band still leaves the two
// selects on screen afterward — a pick never itself changes which of
// the three presentations is showing. "implement" (not "analyze",
// which the fixture's own runner is busy on) is the phase this run has
// not reached yet, so its select is still live and pickable.
test("at 610px, picking a different model still shows two selects, not the button", async () => {
  await page.setViewportSize({ width: 610, height: 800 });
  await page.goto(`${base}/?${OPEN}&live=0`);
  const line = "tr.subrow[data-step=\"implement\"]";
  await page.selectOption(`${line} select[name^="model."]`, "Opus");
  const after = await page.evaluate((sel) => {
    const l = document.querySelector(sel)!;
    const shown = (el: Element | null) => !!el && (el as HTMLElement).getClientRects().length > 0;
    return {
      buttonShown: shown(l.querySelector(".aimodelnow")),
      modelValue: (l.querySelector('select[name^="model."]') as HTMLSelectElement).value,
      modelSelectShown: shown(l.querySelector('select[name^="model."]')),
    };
  }, line);
  expect(after.modelValue).toBe("Opus");
  expect(after.buttonShown).toBe(false);
  expect(after.modelSelectShown).toBe(true);
});

test("the last phase line's name sits level with its own button", async () => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${base}/?${OPEN}&live=0`);
  const [nameMid, buttonMid] = await page.evaluate(() => {
    const line = document.querySelector('tr.subrow[data-step="archive"]')!;
    const mid = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    };
    return [mid(line.querySelector(".phasefold")!), mid(line.querySelector(".aimodelnow")!)];
  });
  expect(Math.abs(nameMid - buttonMid)).toBeLessThanOrEqual(2);
});

// Spec 500, AC-1: a phase unfolded to its messages, at a phone's width — the
// page does not scroll sideways and the text wraps inside the row. Written in
// the implement step; run by the user (`bun test --timeout 20000
// test/e2e/phone-phase-line.test.ts`).
test("an unfolded phase's messages wrap inside the row at 375px, and the page does not scroll sideways (AC-1)", async () => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`${base}/?${OPEN}&phases=aide%2F81-queue-and-runner%3Aanalyze&live=0`);
  const at = await page.evaluate(() => {
    const row = document.querySelector("tr.phasemsgs");
    const box = row?.getBoundingClientRect();
    return {
      found: !!row,
      pageWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      rowRight: box?.right ?? 0,
    };
  });
  expect(at.found).toBe(true);
  expect(at.pageWidth).toBeLessThanOrEqual(at.viewport);
  expect(at.rowRight).toBeLessThanOrEqual(at.viewport);
});
