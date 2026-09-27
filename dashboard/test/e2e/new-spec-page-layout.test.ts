// A real-browser check for the New spec page (spec 476): none of these
// cases are about a rule existing — a text-only render test cannot see
// where a popover actually lands once it opens, only that its markup is
// there. Modelled on specs-page-layout.test.ts's own harness/viewport
// pattern.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../helpers/browser-deadline.ts";
import { queueHarness } from "../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-new-spec-layout-");
let browser: Browser;
let page: Page;
let base: string;

// A <details> fires its own "toggle" event from a QUEUED task, not
// synchronously with the click that opens it (menu-script.ts's flip
// decision runs from that event) — reading a just-opened popover's rect
// straight after `.click()` resolves can still see its pre-flip
// position. Two animation frames is one full task-plus-render cycle,
// well past where the queued event has already run.
function settle(p: Page): Promise<void> {
  return p.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  // The board's own model choices, because the page's LAYOUT depends on
  // them: each choice adds a picker to the phase table, the table's
  // width is what pushes the acceptance column rightwards, and the
  // column's position is what decides whether a popover opening
  // rightwards has room. A harness with no choices drew a 146px table
  // where the serving board draws a 402px one, and every popover then
  // had room to spare — the page under test was not the page anyone
  // looks at. Measured against the serving board on 2026-09-16: with
  // these five, the popovers land on exactly the same pixels there and
  // here (255px past the right edge at 760, 115px at 900).
  const started = harness.start({
    extra: {
      queueDefaults: {
        timeoutSec: { default: 1200 },
        permissionMode: { default: "acceptEdits" },
        model: { default: "Sonnet" },
        modelChoices: {
          Fable: {},
          Opus: {},
          Sonnet: {},
          "gpt-5.6-sol": { tool: "codex" as const },
          "gpt-6-astra": { tool: "codex" as const },
        },
      },
    },
  });
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
// Spec 477 Round 3: the "Depends on" field's own "(?)" sits near the
// LEFT edge of the form (first field on its own row, no acceptance-col
// style override) — the opposite bug from the acceptance-col popovers
// above, and the one 1-description.md's own report names.
const DEPENDS_SUMMARY = ".depends-col .fieldhead .fieldend details.intro > summary";
const DEPENDS_POPOVER = ".depends-col .fieldhead .fieldend details.intro[open] p";

function rectsIntersect(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// Spec 553: the switches moved off the phase table's own row and onto
// the Project field's — this is the one field every popover/geometry
// case below now measures against instead of the table.
const PROJECT_FIELD = '#new-spec-form .frow .field:has(select[name="project"])';

// AC-2: the switches sit beside the Project field, not among the phase
// table's rows or on a full-width line below it.
test("AC-2: the acceptance switches' column sits beside the Project field, not below it", async () => {
  await page.setViewportSize({ width: 1270, height: 900 });
  await withBrowser(page.goto(`${base}/new?live=0`), "page.goto(/new)");
  const [projectField, col] = await Promise.all([
    page.locator(PROJECT_FIELD).evaluate((el) => el.getBoundingClientRect()),
    page.locator(".acceptance-col").evaluate((el) => el.getBoundingClientRect()),
  ]);
  expect(col.left).toBeGreaterThanOrEqual(projectField.right - 1);
  // Beside it, not far below where a full-width line would have put it.
  expect(col.top).toBeLessThan(projectField.bottom);
});

// AC-1/AC-7: Create sits on the Project label's own line, at every
// width — including phone width, where nothing may run past the edge.
test("AC-1/AC-7: Create shares the Project label's line, and nothing overflows at phone width", async () => {
  await page.setViewportSize({ width: 760, height: 900 });
  await withBrowser(page.goto(`${base}/new?live=0`), "page.goto(/new)");
  const [label, create] = await Promise.all([
    page.locator(`${PROJECT_FIELD} .fieldhead span`).first().evaluate((el) => el.getBoundingClientRect()),
    page.locator("#new-spec-form").getByRole("button", { name: "Create" }).evaluate((el) => el.getBoundingClientRect()),
  ]);
  // "Same line" means their vertical ranges overlap — not equal tops,
  // which the button's own padding always throws off by a few pixels.
  expect(label.top).toBeLessThan(create.bottom);
  expect(label.bottom).toBeGreaterThan(create.top);
  const rowRights = await page.locator("#new-spec-form .frow, #new-spec-form > .field").evaluateAll(
    (els) => els.map((el) => el.getBoundingClientRect().right),
  );
  for (const right of rowRights) expect(right).toBeLessThanOrEqual(760);
});

for (const viewport of [
  // Spec 477 Round 3: 760px is the narrower of the two widths
  // 1-description.md's own Problem section measures ("115 piksler
  // utenfor ved 900, 255 ved 760") — the installed app runs narrower
  // than 1000px, and 760 was not covered until now.
  { name: "narrower", width: 760, height: 900 },
  // Spec 477: the 640/40rem wrap breakpoint and 1270px laptop width
  // below had no coverage between them — the width range most likely
  // to reproduce the reported overflow, since `.acceptance-col` sits
  // beside its neighbor without wrapping there.
  { name: "narrow", width: 900, height: 900 },
  { name: "laptop", width: 1270, height: 900 },
  { name: "wide", width: 1920, height: 1080 },
]) {
  describe(`at ${viewport.name} width (${viewport.width}px)`, () => {
    // AC-3: each popover stays fully on screen when opened from its
    // position beside the Project field (spec 553).
    test("AC-3: the acceptance switch's popover stays within the viewport", async () => {
      await page.setViewportSize(viewport);
      await withBrowser(page.goto(`${base}/new?live=0`), "page.goto(/new)");
      await page.locator(ACCEPT_SUMMARY).click();
      await settle(page);
      const rect = await page.locator(ACCEPT_POPOVER).evaluate((el) => el.getBoundingClientRect());
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(viewport.width);
      expect(rect.bottom).toBeLessThanOrEqual(viewport.height);
    });

    test("AC-3: the AI-formulate switch's popover stays within the viewport", async () => {
      await page.setViewportSize(viewport);
      await withBrowser(page.goto(`${base}/new?live=0`), "page.goto(/new)");
      await page.locator(FORMULATE_SUMMARY).click();
      await settle(page);
      const rect = await page.locator(FORMULATE_POPOVER).evaluate((el) => el.getBoundingClientRect());
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(viewport.width);
      expect(rect.bottom).toBeLessThanOrEqual(viewport.height);
    });

    // Spec 477 Round 3, AC-1/AC-4: the left-hand-icon case
    // 1-description.md's Problem section reports — opens rightward
    // (flipped) once its plain leftward default would run past the
    // left edge.
    test("AC-1/AC-4: the Depends-on field's popover stays within the viewport", async () => {
      await page.setViewportSize(viewport);
      await withBrowser(page.goto(`${base}/new?live=0`), "page.goto(/new)");
      await page.locator(DEPENDS_SUMMARY).click();
      await settle(page);
      const rect = await page.locator(DEPENDS_POPOVER).evaluate((el) => el.getBoundingClientRect());
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(viewport.width);
      expect(rect.bottom).toBeLessThanOrEqual(viewport.height);
    });
  });
}

// AC-4 (spec 553): opened alone, neither popover reaches the other
// switch or the Project field — its new neighbor, since the phase table
// moved to the end of the page and is no longer beside the column.
test("AC-4: the acceptance switch's popover does not overlap the AI-formulate switch or the Project field", async () => {
  await page.setViewportSize({ width: 1270, height: 900 });
  await withBrowser(page.goto(`${base}/new?live=0`), "page.goto(/new)");
  await page.locator(ACCEPT_SUMMARY).click();
  await settle(page);
  const [popover, projectField, formulateLabel] = await Promise.all([
    page.locator(ACCEPT_POPOVER).evaluate((el) => el.getBoundingClientRect()),
    page.locator(PROJECT_FIELD).evaluate((el) => el.getBoundingClientRect()),
    page.locator('label[data-ai-formulate="1"]').evaluate((el) => el.getBoundingClientRect()),
  ]);
  expect(rectsIntersect(popover, projectField)).toBe(false);
  expect(rectsIntersect(popover, formulateLabel)).toBe(false);
});

test("AC-4: the AI-formulate switch's popover does not overlap the acceptance switch or the Project field", async () => {
  await page.setViewportSize({ width: 1270, height: 900 });
  await withBrowser(page.goto(`${base}/new?live=0`), "page.goto(/new)");
  await page.locator(FORMULATE_SUMMARY).click();
  await settle(page);
  const [popover, projectField, acceptLabel] = await Promise.all([
    page.locator(FORMULATE_POPOVER).evaluate((el) => el.getBoundingClientRect()),
    page.locator(PROJECT_FIELD).evaluate((el) => el.getBoundingClientRect()),
    page.locator('label[data-acceptance="1"]').evaluate((el) => el.getBoundingClientRect()),
  ]);
  expect(rectsIntersect(popover, projectField)).toBe(false);
  expect(rectsIntersect(popover, acceptLabel)).toBe(false);
});

// Spec 508: the project select is `required`, so an empty project is
// stopped by the browser at the field, before anything is sent.
async function pressCreate(fill: { title: boolean }): Promise<{ requests: number; focused: string | null }> {
  await withBrowser(page.goto(`${base}/new?live=0`), "page.goto(/new)");
  let requests = 0;
  const count = (r: { url(): string }) => {
    if (r.url().includes("/api/queue/create")) requests++;
  };
  page.on("request", count);
  try {
    if (fill.title) {
      await page.locator('#new-spec-form input[name="title"]').fill("A title");
      await page.locator('#new-spec-form textarea[name="description"]').fill("A description");
    }
    await page.locator("#new-spec-form").getByRole("button", { name: "Create" }).click();
    await settle(page);
    const focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("name") ?? null);
    return { requests, focused };
  } finally {
    page.off("request", count);
  }
}

test("Create with no project chosen focuses the project field and sends nothing (AC-1)", async () => {
  const { requests, focused } = await pressCreate({ title: true });
  expect(focused).toBe("project");
  expect(requests).toBe(0);
  const message = await page.locator('#new-spec-form select[name="project"]').evaluate((el) => (el as HTMLSelectElement).validationMessage);
  expect(message).not.toBe("");
});

test("with everything empty Create focuses the project field first (AC-2)", async () => {
  const { focused } = await pressCreate({ title: false });
  expect(focused).toBe("project");
});

test("Create with no project chosen leaves no \"project is required\" line at the bottom (AC-4)", async () => {
  await pressCreate({ title: true });
  expect(await page.locator("#new-spec-form .refused").innerText()).toBe("");
  expect((await page.locator("body").innerText()).toLowerCase()).not.toContain("project is required");
});
