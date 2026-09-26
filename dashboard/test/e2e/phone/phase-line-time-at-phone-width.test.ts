// AC-5/AC-7 (spec 480): with the compact model button narrowed to a
// bare name, the Time column shows on the same line as a phase's state
// at phone width, and the line does not wrap. `bun test` can only prove
// a CSS rule's source text is there (`responsive.test.ts`) and that the
// markup it selects on is in the rendered HTML — whether the line
// actually stays one row tall at a real width is a layout-engine
// question only a browser answers.
//
// Not run as part of this round's own GREEN/REFACTOR confirmation
// (3-solution.md, "Testing" — "e2e"): `aide`/`dashboard` is not on this
// operator's quick e2e allow-list (Atlasaurus, PaceUp only). Written so
// AC-7 is met — the file exists and checks AC-5 at the three named
// widths — and left for the user's own run.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-phase-time-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  const started = harness.start({
    extra: {
      // The board's own model choices configured (AC-7's own wording) —
      // a bare-name button needs at least one real entry to show.
      queueDefaults: {
        timeoutSec: {},
        permissionMode: {},
        model: {},
        modelChoices: { sonnet: {}, "codex-fast": { tool: "codex" } },
      },
    },
  });
  base = started.base;
  ran(started.dir, ["create", "analyze"]);
  await new Promise((r) => setTimeout(r, 400));
  await withBrowser(
    page.goto(`${base}/?live=0&open=aide%2F81-queue-and-runner`),
    "page.goto(/?live=0)",
  );
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

const WIDTHS = [360, 390, 430];

// AC-5's own wording (spec 480, Round 2): "the Time values ... SHALL
// start at the same horizontal position ... on every phase line." The
// `ran(["create", "analyze"])` fixture above already mixes a run phase
// (a "Done" badge) with a not-yet-run one (a bare dash, no badge at
// all) — the exact combination that exposed the gap a single-row check
// could not see.
test("the phase line's Time shows on the state's line, at 360/390/430px, without wrapping, and shares one left edge", async () => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await withBrowser(
      page.goto(`${base}/?live=0&open=aide%2F81-queue-and-runner`),
      `page.goto at ${width}px`,
    );
    const rows = await page
      .locator('table.list tr.subrow[data-step]')
      .evaluateAll((trs) =>
        trs.map((tr) => ({
          height: tr.getBoundingClientRect().height,
          startedX: tr.querySelector('[data-col="started"]')?.getBoundingClientRect().x,
          startedVisible:
            getComputedStyle(tr.querySelector('[data-col="started"]')!).display !== "none",
        })),
      );
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) {
      expect(r.startedVisible).toBe(true);
      // One line tall: two would be roughly double a line's own height —
      // the same style of check `specs-page-layout.test.ts` already uses
      // elsewhere for "did this wrap".
      expect(r.height).toBeLessThan(40);
    }
    const xs = new Set(rows.map((r) => r.startedX));
    expect(xs.size).toBe(1);
  }
});

// The spec's own line keeps its summed Time at phone width, after the
// state badge and on the same line as it; its Cost stays off the phone.
test("the spec line's summed Time follows the state at 360/390/430px, and Cost is not shown", async () => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await withBrowser(page.goto(`${base}/?live=0`), `page.goto at ${width}px`);
    const m = await page.locator("table.list tr.specstate").first().evaluate((tr) => {
      const state = tr.querySelector('[data-col="state"]')!.getBoundingClientRect();
      const time = tr.querySelector('[data-col="started"]') as HTMLElement;
      const box = time.getBoundingClientRect();
      return {
        timeShown: getComputedStyle(time).display !== "none" && box.width > 0,
        text: time.textContent!.trim(),
        after: box.left >= state.right - 1,
        sameLine: Math.abs(box.top - state.top) < 8,
        costShown: getComputedStyle(tr.querySelector('[data-col="cost"]')!).display !== "none",
      };
    });
    expect(m).toEqual({ timeShown: true, text: m.text, after: true, sameLine: true, costShown: false });
    expect(m.text).not.toBe("");
  }
});
