// A message line the page's script fills must come out the same as one the
// server filled: the same icon, the same classes, the same words. The
// server draws the line; the script writes only its words, into the
// server's own markup in happy-dom.

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { messageSlot } from "../../src/render/ui/components";
import { writeLine } from "../../src/specs-client/press.ts";
import { settingsAnswer } from "../../src/specs-client/forms.ts";

/** The markup parsed into a document, and its first element back. */
function parse(html: string): Element {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document.body.firstElementChild as unknown as Element;
}

describe("a script-filled message line", () => {
  test("is the line the server draws with the same words, icon included (AC-3)", () => {
    const line = parse(messageSlot("refused"));
    writeLine(line, "could not stop");
    expect(line.outerHTML).toBe(parse(messageSlot("refused", "failed", { text: "could not stop" })).outerHTML);
  });

  test("an empty text empties the words and keeps the icon (AC-3)", () => {
    const line = parse(messageSlot("refused", "failed", { text: "was refused" }));
    writeLine(line, "");
    expect(line.outerHTML).toBe(parse(messageSlot("refused")).outerHTML);
  });
});

describe("a Settings save's answer", () => {
  function form(): HTMLFormElement {
    return parse(
      `<form data-settings-form>${messageSlot("refused", "failed", { text: "an earlier refusal" })}` +
        `${messageSlot("notice", "info")}</form>`,
    ) as unknown as HTMLFormElement;
  }
  const words = (f: HTMLFormElement, hook: string): string => f.querySelector(`.${hook} span`)?.textContent ?? "?";

  test("a success goes in the notice line and empties the refusal line (AC-3)", () => {
    const f = form();
    settingsAnswer(f, "Defaults saved", true);
    expect({ notice: words(f, "notice"), refused: words(f, "refused") }).toEqual({ notice: "Defaults saved", refused: "" });
  });

  test("a refusal goes in the refusal line and empties the notice line (AC-3)", () => {
    const f = form();
    settingsAnswer(f, "Defaults saved", true);
    settingsAnswer(f, "timeout must be a number", false);
    expect({ notice: words(f, "notice"), refused: words(f, "refused") }).toEqual({
      notice: "",
      refused: "Timeout must be a number",
    });
  });
});
