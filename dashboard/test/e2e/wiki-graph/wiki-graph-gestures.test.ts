// The Wiki tab's graph, made live by script: a press opens a page and a
// drag does not, a drag moves one point and its lines follow while the
// others stay, the wheel and a background drag pan and zoom the whole
// graph, and the same two gestures work by touch — one finger for a drag
// or a pan, two for a pinch (AC-2, AC-3, criteria 4 and 7 to 12).
//
// Not run by the session: Aide is not a project where the session runs the
// e2e suite. CI runs it (`make test-e2e`), and by hand:
// `cd dashboard && bun test --timeout 30000 test/e2e/wiki-graph/wiki-graph-gestures.test.ts`.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { cleanupBoards, untilTab, wikiBoard } from "../../queue-routes/admin/wiki/wiki-pages-fixtures.ts";

browserDeadline();

const INDEX = [
  "# Wiki index", "", "One line per page of the wiki.", "",
  "- [Alpha](alpha.md) — Links to Bravo.",
  "- [Bravo](bravo.md) — Linked from Alpha.",
  "- [Charlie](charlie.md) — Stands alone.",
  "",
].join("\n");
const ALPHA = "# Alpha\n\nSee [Bravo](bravo.md).\n";
const BRAVO = "# Bravo\n\nBack to nothing.\n";
const CHARLIE = "# Charlie\n\nNo links here.\n";

let browser: Browser;
let base: string;
let stop: () => void;

beforeAll(async () => {
  browser = await chromium.launch();
  const board = await wikiBoard({ "index.md": INDEX, "alpha.md": ALPHA, "bravo.md": BRAVO, "charlie.md": CHARLIE });
  base = board.base;
  stop = board.stop;
  await untilTab(base, "/projects/aide?tab=wiki", (h) => h.includes("data-wikigraph"));
});

afterAll(async () => {
  await browser.close();
  stop();
  cleanupBoards();
});

let context: BrowserContext;
let page: Page;

async function openGraph(viewport = { width: 1000, height: 800 }, extra: Record<string, unknown> = {}): Promise<Page> {
  context = await browser.newContext({ viewport, ...extra });
  page = await context.newPage();
  await page.goto(`${base}/projects/aide?tab=wiki`);
  const graph = page.locator("svg[data-wikigraph]");
  await graph.waitFor();
  // The graph sits below the page list's intro and can start past the
  // viewport's bottom edge, where a pointer or a touch reaches nothing.
  await graph.scrollIntoViewIfNeeded();
  return page;
}

afterEach(async () => {
  await context?.close();
});

interface NodeBox {
  index: number;
  cx: number;
  cy: number;
  x: number;
  y: number;
}

/** Every point's own centre, in the SVG's own coordinates (`cx`/`cy`) and on
 *  screen (from its element's bounding box) — the two are the same size
 *  since the viewBox is set to the box's own real pixels. */
async function nodeBoxes(p: Page): Promise<NodeBox[]> {
  const nodes = p.locator(".wikinode");
  const count = await nodes.count();
  const out: NodeBox[] = [];
  for (let i = 0; i < count; i++) {
    const el = nodes.nth(i);
    const circle = el.locator("circle");
    const cx = Number(await circle.getAttribute("cx"));
    const cy = Number(await circle.getAttribute("cy"));
    const box = (await el.boundingBox())!;
    out.push({ index: i, cx, cy, x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  return out;
}

const viewportTransform = (p: Page) => p.locator("[data-viewport]").getAttribute("transform");

describe("a press opens a page, a drag does not (AC-2)", () => {
  test("a plain press opens the page (AC-2)", async () => {
    const p = await openGraph();
    const [node] = await nodeBoxes(p);
    await p.mouse.move(node!.x, node!.y);
    await p.mouse.down();
    await p.mouse.up();
    await p.waitForURL(/page=/);
    expect(p.url()).toContain("page=");
  });

  test("a drag past 6px does not open the page, moves the point, and does not start the browser's own link drag (AC-2, AC-3)", async () => {
    const p = await openGraph();
    const before = await nodeBoxes(p);
    const node = before[0]!;
    await p.mouse.move(node.x, node.y);
    await p.mouse.down();
    await p.mouse.move(node.x + 60, node.y + 40, { steps: 10 });
    await p.mouse.up();
    expect(p.url()).not.toContain("page=");
    const after = await nodeBoxes(p);
    expect(Math.hypot(after[0]!.cx - node.cx, after[0]!.cy - node.cy)).toBeGreaterThan(6);
    // No native drag-and-drop started on the link (it would carry a
    // "dragging" state Chromium exposes on the document during one).
    expect(await p.evaluate(() => document.querySelector(".wikinode")?.hasAttribute("draggable"))).toBeFalsy();
  });
});

describe("dragging a point (AC-3)", () => {
  test("moves that point, its line follows, and the other point stays (AC-3)", async () => {
    const p = await openGraph();
    const before = await nodeBoxes(p);
    const dragged = before[0]!;
    const other = before[1]!;
    await p.mouse.move(dragged.x, dragged.y);
    await p.mouse.down();
    await p.mouse.move(dragged.x + 50, dragged.y - 30, { steps: 10 });
    await p.mouse.up();
    const after = await nodeBoxes(p);
    expect(Math.hypot(after[0]!.cx - dragged.cx, after[0]!.cy - dragged.cy)).toBeGreaterThan(20);
    expect(after[1]!.cx).toBeCloseTo(other.cx, 0);
    expect(after[1]!.cy).toBeCloseTo(other.cy, 0);
    const edge = p.locator(".wikiedge").first();
    const x1 = Number(await edge.getAttribute("x1"));
    const y1 = Number(await edge.getAttribute("y1"));
    expect(Math.hypot(x1 - after[0]!.cx, y1 - after[0]!.cy)).toBeLessThan(1);
  });
});

describe("the wheel zooms about the cursor and does not scroll the page (AC-3)", () => {
  test("turning the wheel over the graph changes the view's scale and leaves the page where it was", async () => {
    const p = await openGraph();
    const before = await viewportTransform(p);
    const scrollBefore = await p.evaluate(() => window.scrollY);
    const box = (await p.locator("svg[data-wikigraph]").boundingBox())!;
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.wheel(0, -200);
    const after = await viewportTransform(p);
    expect(after).not.toBe(before);
    expect(await p.evaluate(() => window.scrollY)).toBe(scrollBefore);
  });
});

describe("dragging the empty background pans the whole graph (AC-3)", () => {
  test("the view moves, and the points' own settled positions do not", async () => {
    const p = await openGraph();
    const before = await nodeBoxes(p);
    const box = (await p.locator("svg[data-wikigraph]").boundingBox())!;
    // A corner of the box, away from every point.
    const bx = box.x + 12;
    const by = box.y + 12;
    await p.mouse.move(bx, by);
    await p.mouse.down();
    await p.mouse.move(bx + 40, by + 25, { steps: 10 });
    await p.mouse.up();
    const afterTransform = await viewportTransform(p);
    expect(afterTransform).toMatch(/translate\(/);
    const after = await nodeBoxes(p);
    expect(after[0]!.cx).toBeCloseTo(before[0]!.cx, 0);
    expect(after[0]!.cy).toBeCloseTo(before[0]!.cy, 0);
  });
});

describe("data-active (AC-3)", () => {
  test("is set while a pointer is down, and cleared once it is released", async () => {
    const p = await openGraph();
    const box = (await p.locator("svg[data-wikigraph]").boundingBox())!;
    await p.mouse.move(box.x + 12, box.y + 12);
    await p.mouse.down();
    expect(await p.locator("svg[data-wikigraph]").getAttribute("data-active")).not.toBeNull();
    await p.mouse.up();
    expect(await p.locator("svg[data-wikigraph]").getAttribute("data-active")).toBeNull();
  });
});

/** One page's CDP session. A touch the browser has started lives in the
 *  session that started it, so a move or an end sent through a second
 *  session has no touch to belong to. */
const sessions = new WeakMap<Page, CDPSession>();

/** One touch, dispatched through the CDP session Playwright's own API has
 *  no higher-level call for — its `Locator.tap()` only taps, and there is
 *  no `touchmove`. */
async function touch(p: Page, points: { x: number; y: number }[], type: "touchStart" | "touchMove" | "touchEnd") {
  let session = sessions.get(p);
  if (!session) {
    session = await context.newCDPSession(p);
    sessions.set(p, session);
  }
  await session.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd" ? [] : points.map(({ x, y }) => ({ x, y })),
  });
}

describe("one finger, on a phone (AC-3)", () => {
  test("dragging a point with one finger moves it, and the page does not scroll", async () => {
    const p = await openGraph({ width: 375, height: 700 }, { isMobile: true, hasTouch: true });
    const before = await nodeBoxes(p);
    const node = before[0]!;
    await touch(p, [{ x: node.x, y: node.y }], "touchStart");
    await touch(p, [{ x: node.x + 40, y: node.y + 30 }], "touchMove");
    await touch(p, [], "touchEnd");
    const after = await nodeBoxes(p);
    expect(Math.hypot(after[0]!.cx - node.cx, after[0]!.cy - node.cy)).toBeGreaterThan(20);
    expect(await p.evaluate(() => document.documentElement.scrollLeft)).toBe(0);
  });

  test("dragging the background with one finger pans the graph", async () => {
    const p = await openGraph({ width: 375, height: 700 }, { isMobile: true, hasTouch: true });
    const before = await viewportTransform(p);
    const box = (await p.locator("svg[data-wikigraph]").boundingBox())!;
    const start = { x: box.x + 10, y: box.y + 10 };
    await touch(p, [start], "touchStart");
    await touch(p, [{ x: start.x + 35, y: start.y + 20 }], "touchMove");
    await touch(p, [], "touchEnd");
    expect(await viewportTransform(p)).not.toBe(before);
  });
});

describe("two fingers zoom about their midpoint (AC-3)", () => {
  test("moving two touches apart zooms in", async () => {
    const p = await openGraph({ width: 375, height: 700 }, { isMobile: true, hasTouch: true });
    const box = (await p.locator("svg[data-wikigraph]").boundingBox())!;
    const midX = box.x + box.width / 2;
    const midY = box.y + box.height / 2;
    const first = [{ x: midX - 10, y: midY }, { x: midX + 10, y: midY }];
    await touch(p, first, "touchStart");
    const spread = [{ x: midX - 40, y: midY }, { x: midX + 40, y: midY }];
    await touch(p, spread, "touchMove");
    await touch(p, [], "touchEnd");
    const transform = (await viewportTransform(p)) ?? "";
    const scale = Number(transform.match(/scale\(([\d.]+)\)/)?.[1] ?? "1");
    expect(scale).toBeGreaterThan(1);
  });
});
