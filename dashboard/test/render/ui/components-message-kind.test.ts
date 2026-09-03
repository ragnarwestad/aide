// Spec 372, REQ-1/REQ-2: a row message is one of exactly three kinds —
// info, waiting, failed — decided once by rowMessage() from the kind a
// producer states, never guessed from a colour at the call site. Each
// kind carries its own class (which row-message.css keys its colour on)
// and its own <svg> mark, so a reader who cannot tell red from amber
// still sees which of the three a message is.
import { describe, expect, test } from "bun:test";
import { rowMessage, type MessageVariant } from "../../../src/render/ui/components.ts";

const KINDS: MessageVariant[] = ["info", "waiting", "failed"];

describe("rowMessage — the three kinds, decided once (REQ-1, REQ-2)", () => {
  test("accepts exactly info, waiting, failed — and classes the row with the kind's own name", () => {
    for (const kind of KINDS) {
      expect(rowMessage(kind, "x")).toContain(`class="rowmsg ${kind}"`);
    }
  });

  test("each kind draws its own <svg> mark — none is left without one, and no two share markup", () => {
    const svgs = KINDS.map((kind) => rowMessage(kind, "x").match(/<svg[\s\S]*?<\/svg>/)?.[0]);
    for (const svg of svgs) expect(svg).toBeTruthy();
    expect(new Set(svgs).size).toBe(KINDS.length);
  });

  test("waiting keeps the existing warning triangle", () => {
    expect(rowMessage("waiting", "x")).toContain("<path d=\"M8 2.5l6 11H2z\">");
  });
});
