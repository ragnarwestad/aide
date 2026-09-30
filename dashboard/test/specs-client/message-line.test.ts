// The server draws a message line empty; the page's script writes only
// its words, into the server's own markup in happy-dom, and the icon and
// classes stay as the server drew them.

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { messageSlot } from "../../src/render/ui/components";
import { writeLine } from "../../src/specs-client/press.ts";

/** The markup parsed into a document, and its first element back. */
function parse(html: string): Element {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document.body.firstElementChild as unknown as Element;
}

describe("a script-filled message line", () => {
  test("an empty text empties the words and keeps the icon (AC-3)", () => {
    const line = parse(messageSlot("refused"));
    writeLine(line, "was refused");
    writeLine(line, "");
    expect(line.outerHTML).toBe(parse(messageSlot("refused")).outerHTML);
  });
});
