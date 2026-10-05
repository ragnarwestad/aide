// A tab with an editor, in a real browser: on a screen wider than a phone it
// fills the window and the document scrolls inside the editor, so the
// toolbar, Save and Cancel stay in view; at phone width and on a tab with no
// editor the page scrolls as a whole.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness, statusSaying } from "../../helpers/queue-server.ts";
import { recording } from "../../spec-page/spec-checks-fixtures.ts";

browserDeadline();
const FOLDER = "81-queue-and-runner";
const ARCHIVED = "150-one-page-shows-the-whole-spec";
// Far longer than any window here: reaching the end means scrolling.
const paragraphs = (what: string): string =>
  Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1} of the ${what}.`).join("\n\n");
const DESCRIPTION = `# Queue - Description\n\n## Description\n\n${paragraphs("description")}\n`;
const ANALYSIS = `# Queue - Analysis\n\n## Codebase analysis\n\n${paragraphs("analysis")}\n`;
// The lead of Approach B sits a screen or more below the top.
const SOLUTION =
  `# Queue - Solution\n\n## Approaches\n\n${paragraphs("scope")}\n\n` +
  "**Approach A: Hold the chained implement (recommended).** a\n\n" +
  `${paragraphs("first approach")}\n\n` +
  "**Approach B: End the job after analyze (real alternative).** b\n\n" +
  `${paragraphs("second approach")}\n`;
const STATUS = statusSaying(["create", "analyze"], `\n${paragraphs("status")}\n`);

const harness = queueHarness("aide-e2e-editor-fills-the-window-");
let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  const started = harness.start({
    extra: { gitRun: recording().run },
    description: DESCRIPTION,
    status: STATUS,
    archivedSpecs: { [ARCHIVED]: { description: DESCRIPTION } },
  });
  base = started.base;
  const spec = join(started.dir, "root", "aide", "specs", FOLDER);
  writeFileSync(join(spec, "2-analysis.md"), ANALYSIS);
  writeFileSync(join(spec, "3-solution.md"), SOLUTION);
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

interface Box { top: number; bottom: number }
interface Layout {
  windowHeight: number;
  pageScroll: number;
  pageHeight: number;
  /** The room under the editor the page itself keeps: main's bottom padding. */
  pageBottomPadding: number;
  editor: Box;
  toolbar: Box | null;
  save: Box | null;
  cancel: Box | null;
  /** Whether a scroll box inside the editor has text below its fold, and has scrolled. */
  textOverflows: boolean;
  textScrolled: boolean;
}

/** Everything the criteria ask about, read in one go. The editor's "text box"
 *  is whichever visible box inside it scrolls: the WYSIWYG contents or, in
 *  Markdown mode, the library's own container. */
function measure(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const box = (el: Element | null): { top: number; bottom: number } | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    };
    const host = document.getElementById("spec-editor-host")!;
    const scrollers = [...host.querySelectorAll<HTMLElement>("*")].filter((el) => {
      const overflowY = getComputedStyle(el).overflowY;
      return (overflowY === "auto" || overflowY === "scroll") && el.getClientRects().length > 0;
    });
    return {
      windowHeight: window.innerHeight,
      pageScroll: document.documentElement.scrollTop,
      pageHeight: document.documentElement.scrollHeight,
      pageBottomPadding: parseFloat(getComputedStyle(document.querySelector("main")!).paddingBottom),
      editor: box(host)!,
      toolbar: box(host.querySelector(".toastui-editor-toolbar")),
      save: box(document.getElementById("specform-save")),
      cancel: box(document.getElementById("specform-cancel")),
      textOverflows: scrollers.some((el) => el.scrollHeight > el.clientHeight + 1),
      textScrolled: scrollers.some((el) => el.scrollTop > 0),
    };
  });
}

/** Re-reads the layout until `done` holds or a few seconds pass: the library
 *  and the browser lay the editor out a frame or two after it mounts. */
async function settled(page: Page, done: (l: Layout) => boolean): Promise<Layout> {
  const deadline = Date.now() + 5_000;
  let layout = await measure(page);
  while (!done(layout) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    layout = await measure(page);
  }
  return layout;
}

const inWindow = (b: Box | null, l: Layout): boolean => b !== null && b.top >= 0 && b.bottom <= l.windowHeight;
// The editor's bottom edge is within the page's bottom padding (and a few
// pixels) of the window's bottom: a collapsed editor is not.
const fillsTheRoom = (l: Layout): boolean =>
  l.editor.bottom <= l.windowHeight && l.windowHeight - l.editor.bottom <= l.pageBottomPadding + 4;
const pageFitsTheWindow = (l: Layout): boolean => l.pageScroll === 0 && l.pageHeight <= l.windowHeight;

async function open(tab: string, size: { width: number; height: number }, folder = FOLDER, hash = ""): Promise<Page> {
  const page = await browser.newPage({ viewport: size });
  await withBrowser(page.goto(`${base}/specs/aide/${folder}?tab=${tab}&live=0${hash}`), "page.goto(spec page)");
  await page.locator("#spec-editor-host[data-mounted]").waitFor();
  return page;
}

/** Puts the caret at the end of the document and types there. Reaches the
 *  end by scrolling to the last paragraph and clicking it, since the key
 *  that jumps to the end of a document differs by platform. */
async function typeAtTheEnd(page: Page): Promise<void> {
  const last = page.locator("#spec-editor-host [contenteditable=true]:visible > p").last();
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await page.keyboard.press("End");
  await page.keyboard.type("Typed at the end.");
}

const WIDE = { width: 1280, height: 720 };

describe("a tab with an editor on a wide screen", () => {
  for (const [tab, name] of [["description", "Description"], ["analysis", "Analysis"], ["solution", "Solution"]] as const) {
    test(`${name}: only the editor scrolls, and Save, Cancel and the toolbar stay in view (AC-1)`, async () => {
      const page = await open(tab, WIDE);
      await typeAtTheEnd(page);
      const l = await settled(page, (m) => fillsTheRoom(m) && pageFitsTheWindow(m) && m.textScrolled);
      expect(pageFitsTheWindow(l)).toBe(true);
      expect(fillsTheRoom(l)).toBe(true);
      expect(l.textScrolled).toBe(true);
      expect(inWindow(l.toolbar, l)).toBe(true);
      expect(inWindow(l.save, l)).toBe(true);
      expect(inWindow(l.cancel, l)).toBe(true);
      await page.close();
    });
  }

  test("the editor follows the window's height and the page never scrolls (AC-2)", async () => {
    const page = await open("description", WIDE);
    const short = await settled(page, fillsTheRoom);
    expect(fillsTheRoom(short)).toBe(true);
    expect(pageFitsTheWindow(short)).toBe(true);

    await page.setViewportSize({ width: 1280, height: 950 });
    const tall = await settled(page, (m) => fillsTheRoom(m) && m.windowHeight === 950);
    expect(fillsTheRoom(tall)).toBe(true);
    expect(pageFitsTheWindow(tall)).toBe(true);
    expect(tall.editor.bottom - tall.editor.top).toBeGreaterThan(short.editor.bottom - short.editor.top);
    await page.close();
  });

  test("an approach's address shows its lead by scrolling the editor, not the page (AC-3)", async () => {
    const page = await open("solution", WIDE, FOLDER, "#approach-b");
    const lead = page.locator("strong:visible", { hasText: "Approach B: End the job after analyze" }).first();
    await lead.waitFor();
    const l = await settled(page, (m) => m.textScrolled && fillsTheRoom(m) && pageFitsTheWindow(m));
    expect(await lead.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    })).toBe(true);
    expect(pageFitsTheWindow(l)).toBe(true);
    expect(fillsTheRoom(l)).toBe(true);
    expect(l.textScrolled).toBe(true);
    await page.close();
  });
});

describe("the phone width", () => {
  test("at 375 wide the editor grows with its text and the page scrolls (AC-4)", async () => {
    const page = await open("description", { width: 375, height: 800 });
    const l = await settled(page, (m) => m.pageHeight > m.windowHeight);
    expect(l.textOverflows).toBe(false);
    expect(l.pageHeight).toBeGreaterThan(l.windowHeight);
    await page.close();
  });

  test("at exactly 40rem the editor grows with its text; a rem wider it fills the room (AC-4)", async () => {
    const edge = await open("description", { width: 640, height: 800 });
    const grown = await settled(edge, (m) => m.pageHeight > m.windowHeight);
    expect(grown.textOverflows).toBe(false);
    expect(grown.pageHeight).toBeGreaterThan(grown.windowHeight);
    await edge.close();

    const above = await open("description", { width: 656, height: 720 });
    const fixed = await settled(above, (m) => fillsTheRoom(m) && pageFitsTheWindow(m));
    expect(fillsTheRoom(fixed)).toBe(true);
    expect(pageFitsTheWindow(fixed)).toBe(true);
    await above.close();
  });
});

describe("a tab with no editor", () => {
  const scrollsAsAPage = async (page: Page): Promise<void> => {
    const scrolled = await page.evaluate(() => {
      const taller = document.documentElement.scrollHeight > window.innerHeight;
      window.scrollTo(0, 500);
      return { taller, scrollY: window.scrollY };
    });
    expect(scrolled.taller).toBe(true);
    expect(scrolled.scrollY).toBeGreaterThan(0);
    await page.close();
  };

  test("Status scrolls as a page (AC-5)", async () => {
    const page = await browser.newPage({ viewport: WIDE });
    await withBrowser(page.goto(`${base}/specs/aide/${FOLDER}?tab=status&live=0`), "page.goto(status tab)");
    await scrollsAsAPage(page);
  });

  test("an archived spec's Description scrolls as a page (AC-5)", async () => {
    const page = await browser.newPage({ viewport: WIDE });
    await withBrowser(page.goto(`${base}/specs/aide/${ARCHIVED}?tab=description&live=0`), "page.goto(archived spec)");
    await scrollsAsAPage(page);
  });
});
