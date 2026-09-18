// A phase line on a phone, as a browser lays it out.
//
// Every width here is a media query's and a flex line's answer, so no
// string in the stylesheet says whether "Sonnet" fits its button or
// whether the phases' state starts under the spec's own. Those are the
// four things that were wrong on spec 480's second round: the model name
// cut to "Sonne", "Running (3)" clipped into Time, Time pushed past the
// edge, and the state and Time columns drifting apart as the screen
// widened — measured here at the widths a phone is.

import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { queueHarness } from "../helpers/queue-server.ts";

setDefaultTimeout(30_000);

const TOKEN = "s3cret-token";
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
      queueToken: TOKEN,
      queueRunnerBin: runner,
      queueDefaults: {
        timeoutSec: { default: 600 },
        permissionMode: { default: "acceptEdits" },
        model: { default: "Sonnet" },
        modelChoices: { Sonnet: { tool: "claude" } },
      },
    },
  });
  base = started.base;
  await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
    body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze", "implement", "archive"] }),
  });
  await page.goto(`${base}/?token=${TOKEN}&live=0`);
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

test("a wider phone leaves the state and Time columns where they were", async () => {
  const narrow = await lineAt(390);
  const wide = await lineAt(600);
  expect(Math.abs(wide.phaseState - narrow.phaseState)).toBeLessThanOrEqual(1);
  expect(Math.abs(wide.timeLeft - narrow.timeLeft)).toBeLessThanOrEqual(1);
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
