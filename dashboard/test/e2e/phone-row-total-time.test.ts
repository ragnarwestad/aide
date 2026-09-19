// The row's total on a phone, as a browser lays it out (spec 496).
//
// Whether the button, the state copy and the total stay on one line, and
// whether the total's left edge holds still as its text changes, are a
// grid's and a flex line's answers: no string in the stylesheet says.

import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { queueHarness } from "../helpers/queue-server.ts";

setDefaultTimeout(30_000);

const OPEN = "open=aide%2F81-queue-and-runner";
const WIDTHS = [360, 375, 390, 412, 430, 432, 440, 500, 600];

const harness = queueHarness("aide-e2e-phone-row-total-");
let browser: Browser;
let page: Page;
let base: string;
let runnerDir: string;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
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
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
  rmSync(runnerDir, { recursive: true, force: true });
});

async function open(width: number, height = 800, lang = "en") {
  await page.setViewportSize({ width, height });
  await page.goto(`${base}/?${OPEN}&live=0&lang=${lang}`);
}

const capture = () =>
  page.evaluate(() => {
    const cap = document.querySelector('tr.subrow[data-caption="1"]')!;
    const rect = (el: Element | null) => el!.getBoundingClientRect();
    const btn = cap.querySelector(".actionslot > .btn, .actionslot > .actionform");
    const state = cap.querySelector(".actionslot > .headstate");
    const total = cap.querySelector(".actionslot > .headtime");
    const text = total!.querySelector("span")!;
    return {
      tops: [rect(btn).top, rect(state).top, rect(total).top],
      btnLeft: rect(btn).left,
      stateLeft: rect(state).left,
      totalLeft: rect(text).left,
      capHeight: rect(cap).height,
      phaseTimeLefts: [...document.querySelectorAll('tr.subrow[data-step] [data-col="started"] span')].map(
        (s) => s.getBoundingClientRect().left,
      ),
      phaseHeights: [...document.querySelectorAll("tr.subrow[data-step]")].map((r) => r.getBoundingClientRect().height),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

for (const lang of ["nb", "en"]) {
  test(`${lang}: the button, the state and the total share a line, and Time lines up with the phases (AC-1, AC-3)`, async () => {
    for (const width of WIDTHS) {
      await open(width, 800, lang);
      const m = await capture();
      expect(Math.max(...m.tops) - Math.min(...m.tops), `at ${width}px`).toBeLessThanOrEqual(12);
      expect(m.overflow, `at ${width}px`).toBeLessThanOrEqual(0);
      for (const left of m.phaseTimeLefts) expect(Math.abs(left - m.totalLeft), `at ${width}px`).toBeLessThanOrEqual(1);
      const singleLine = Math.min(...m.phaseHeights);
      for (const h of m.phaseHeights) expect(h, `at ${width}px`).toBeLessThan(singleLine * 2);
    }
  });
}

test("the total's text changing moves nothing on the line (AC-3)", async () => {
  await open(360);
  const before = await capture();
  for (const text of ["9s", "59m 59s", "12h 05m", "100h 05m"]) {
    await page.evaluate((t) => {
      document.querySelector('tr.subrow[data-caption="1"] .headtime span')!.textContent = t;
    }, text);
    const after = await capture();
    expect(after.totalLeft, text).toBe(before.totalLeft);
    expect(after.btnLeft, text).toBe(before.btnLeft);
    expect(after.stateLeft, text).toBe(before.stateLeft);
    expect(after.capHeight, text).toBe(before.capHeight);
  }
});

test("a desktop and a phone held sideways show no copy of the total (AC-4)", async () => {
  for (const [w, h] of [[1280, 800], [844, 390]] as const) {
    await open(w, h);
    const shown = await page.evaluate(
      () => document.querySelector('tr.subrow[data-caption="1"] .headtime')!.getClientRects().length > 0,
    );
    expect(shown, `${w}x${h}`).toBe(false);
  }
});
