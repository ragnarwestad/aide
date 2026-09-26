// The caption line of an open row on a phone, as a browser lays it out.
//
// The captions, the row's action and the spec's total share one line,
// as on a desktop: the button in the state column at the phase badges'
// width, the total in the Time column over the phases' times. Whether
// they stay on one line, and hold still as the total's text changes, is
// a flex line's answer: no string in the stylesheet says.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

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
    const caption = cap.querySelector(".phasecell");
    const btn = cap.querySelector(".actionslot .btn");
    const text = cap.querySelector('td[data-col="started"] span')!;
    const phaseState = document.querySelector('tr.subrow[data-step] td[data-col="state"]');
    return {
      tops: [rect(caption).top, rect(btn).top, rect(text).top],
      btnLeft: rect(btn).left,
      btnWidth: rect(btn).width,
      stateLeft: rect(phaseState).left,
      stateWidth: rect(phaseState).width,
      // The centre: Time reads centred in its own column.
      totalLeft: rect(text).left + rect(text).width / 2,
      capHeight: rect(cap).height,
      phaseTimeLefts: [...document.querySelectorAll('tr.subrow[data-step] [data-col="started"] span')].map(
        (s) => s.getBoundingClientRect().left + s.getBoundingClientRect().width / 2,
      ),
      phaseHeights: [...document.querySelectorAll("tr.subrow[data-step]")].map((r) => r.getBoundingClientRect().height),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

for (const lang of ["nb", "en"]) {
  test(`${lang}: the captions, the button and the total share a line, the button in the state column and Time over the phases' times (AC-1, AC-3)`, async () => {
    for (const width of WIDTHS) {
      await open(width, 800, lang);
      const m = await capture();
      expect(Math.max(...m.tops) - Math.min(...m.tops), `at ${width}px`).toBeLessThanOrEqual(12);
      expect(Math.abs(m.btnLeft - m.stateLeft), `at ${width}px`).toBeLessThanOrEqual(1);
      expect(Math.abs(m.btnWidth - m.stateWidth), `at ${width}px`).toBeLessThanOrEqual(1);
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
      document.querySelector('tr.subrow[data-caption="1"] td[data-col="started"] span')!.textContent = t;
    }, text);
    const after = await capture();
    // The centre holds, within the rounding of a fractional width — and
    // a total wider than its column ("100h 05m") spills to both sides
    // now that it is centred, which moves that centre a pixel or two.
    expect(Math.abs(after.totalLeft - before.totalLeft), text).toBeLessThanOrEqual(3);
    expect(after.btnLeft, text).toBe(before.btnLeft);
    expect(after.capHeight, text).toBe(before.capHeight);
  }
});

test("a desktop and a phone held sideways show the total in the caption line's own Time cell (AC-4)", async () => {
  for (const [w, h] of [[1280, 800], [844, 390]] as const) {
    await open(w, h);
    const cell = await page.evaluate(() => {
      const el = document.querySelector('tr.subrow[data-caption="1"] [data-col="started"]') as HTMLElement;
      return el.getClientRects().length > 0 ? el.textContent!.trim() : "";
    });
    expect(cell, `${w}x${h}`).not.toBe("");
  }
});
