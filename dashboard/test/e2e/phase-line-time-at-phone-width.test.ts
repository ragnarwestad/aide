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
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { queueHarness, ran } from "../helpers/queue-server.ts";

setDefaultTimeout(20_000);

const TOKEN = "s3cret-token";

const harness = queueHarness("aide-e2e-phase-time-");
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
  const started = harness.start({
    extra: {
      queueToken: TOKEN,
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
  await withTimeout(
    page.goto(`${base}/?token=${TOKEN}&live=0&open=aide%2F81-queue-and-runner`),
    10_000,
    "page.goto(/?token=)",
  );
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

const WIDTHS = [360, 390, 430];

test("the phase line's Time shows on the state's line, at 360/390/430px, without wrapping", async () => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await withTimeout(
      page.goto(`${base}/?live=0&open=aide%2F81-queue-and-runner`),
      10_000,
      `page.goto at ${width}px`,
    );
    const started = page.locator('table.list tr.subrow[data-step] [data-col="started"]').first();
    expect(await started.isVisible()).toBe(true);
    // One line tall: two would be roughly double a line's own height —
    // the same style of check `specs-page-layout.test.ts` already uses
    // elsewhere for "did this wrap".
    const height = await page
      .locator('table.list tr.subrow[data-step]')
      .first()
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeLessThan(40);
  }
});
