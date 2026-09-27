// The Wiki tab through a real server, on a real origin and the dashboard's
// own clone. What is proven here is the wiring: which page the address asks
// for, that the viewer is sent only then, and that a project with no wiki is
// left alone.

import { afterEach, describe, expect, test } from "bun:test";
import { cleanupBoards, INDEX, LANDING, SKILLS, untilTab, wikiBoard } from "./wiki-pages-fixtures.ts";

const stops: (() => void)[] = [];
afterEach(() => {
  while (stops.length) stops.pop()!();
  cleanupBoards();
});
const board = async (pages?: Record<string, string>) => {
  const b = await wikiBoard(pages);
  stops.push(b.stop);
  return b;
};
const WIKI = { "index.md": INDEX, "landing.md": LANDING, "skills.md": SKILLS };
const TAB = "/projects/aide?tab=wiki";
const listed = (h: string) => h.includes("How a branch lands.");

describe("the Wiki tab lists and opens the wiki's pages (AC-1, AC-2, AC-5)", () => {
  test("?tab=wiki opens on Pages and lists the pages in the index's order, with none of the Build panel beside them (AC-1)", async () => {
    const { base } = await board(WIKI);
    const html = await untilTab(base, TAB, listed);
    expect(html.indexOf("Landing")).toBeLessThan(html.indexOf("Skills"));
    expect(html).toContain("The slash commands.");
    expect(html).not.toContain('action="/api/queue/projects/aide/wiki"');
    expect(html).not.toContain("/spec-viewer.js");
  });

  test("the state of a page written from a commit the project lacks reads Unknown (AC-4)", async () => {
    const { base } = await board(WIKI);
    const html = await untilTab(base, TAB, listed);
    expect(html).toContain("Unknown");
    expect(html).toContain("By hand");
  });

  test("?page= opens that page with the viewer, its links rewritten, and no self-reload (AC-2)", async () => {
    const { base } = await board(WIKI);
    await untilTab(base, TAB, listed);
    const html = await (await fetch(`${base}${TAB}&page=landing.md`)).text();
    expect(html).toContain('<script src="/spec-viewer.js">');
    expect(html).toContain("spec-editor-raw");
    expect(html).toContain("[Skills](/projects/aide?tab=wiki&amp;page=skills.md)");
    expect(html).not.toContain("wiki: generated");
    expect(html).not.toContain("data-reload-every=");
  });

  test("a name that is not a page name shows the list, and a valid one that is not there says so (AC-5)", async () => {
    const { base } = await board(WIKI);
    await untilTab(base, TAB, listed);
    const bad = await (await fetch(`${base}${TAB}&page=..%2Fx.md`)).text();
    expect(bad).toContain("How a branch lands.");
    expect(bad).not.toContain("spec-editor-host");
    const missing = await (await fetch(`${base}${TAB}&page=nosuch.md`)).text();
    expect(missing).toContain("That page is not in the wiki.");
    expect(missing).toContain("How a branch lands.");
  });

  test("a language change keeps the reader on the same page (AC-5)", async () => {
    const { base } = await board(WIKI);
    await untilTab(base, TAB, listed);
    const html = await (await fetch(`${base}${TAB}&page=landing.md`)).text();
    expect(html).toContain("page=landing.md");
    expect(html).toMatch(/href="[^"]*tab=wiki&(amp;)?page=landing\.md[^"]*lang=/);
  });
});

describe("a project with no wiki (AC-8)", () => {
  test("the tab is drawn as it was, with no pages block and no viewer", async () => {
    const { base } = await board();
    const html = await untilTab(base, TAB, (h) => h.includes("Build wiki"));
    expect(html).toContain("Build wiki");
    expect(html).not.toContain('class="wikipages"');
    expect(html).not.toContain("/spec-viewer.js");
  });
});
