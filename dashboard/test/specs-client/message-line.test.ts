// The server draws a message line empty; the page's script writes only
// its words, into the server's own markup in happy-dom, and the icon and
// classes stay as the server drew them.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { messageSlot } from "../../src/render/ui/components";
import { refusalText, writeLine } from "../../src/specs-client/press.ts";

/** The markup parsed into a document, and its first element back. */
function parse(html: string): Element {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document.body.firstElementChild as unknown as Element;
}

describe("a script-filled message line", () => {
  test("an empty text empties the words and keeps the icon", () => {
    const line = parse(messageSlot("refused"));
    writeLine(line, "was refused");
    writeLine(line, "");
    expect(line.outerHTML).toBe(parse(messageSlot("refused")).outerHTML);
  });
});

describe("a refusal the page's script writes", () => {
  const withLabels = (problem: string, solution: string) => {
    const win = new Window();
    win.document.body.setAttribute("data-problem", problem);
    win.document.body.setAttribute("data-solution", solution);
    (globalThis as { document?: unknown }).document = win.document;
  };
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  test("is a Problem line and a Solution line in the page's own words (AC-6)", () => {
    withLabels("Problem", "Løsning");
    expect(refusalText({ error: "unknown model x", solution: "reload the page" })).toBe(
      "Problem: Unknown model x\nLøsning: Reload the page",
    );
  });

  test("without a fix is the Problem line alone (AC-6)", () => {
    withLabels("Problem", "Løsning");
    expect(refusalText({ error: "unknown model x" })).toBe("Problem: Unknown model x");
  });
});
