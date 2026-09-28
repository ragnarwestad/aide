// The Wiki tab's graph, made live by script: a press on a point opens its
// page, and a drag past 6px moves the point instead of opening it.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
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
  await untilTab(base, "/projects/aide?tab=wiki&wikitab=graph", (h) => h.includes("data-wikigraph"));
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
  await page.goto(`${base}/projects/aide?tab=wiki&wikitab=graph`);
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
