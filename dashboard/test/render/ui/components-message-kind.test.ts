// Spec 372, REQ-1/REQ-2: a row message is one of exactly three kinds —
// info, waiting, failed — decided once by rowMessage() from the kind a
// producer states, never guessed from a colour at the call site. Each
// kind carries its own class (which row-message.css keys its colour on)
// and its own <svg> mark, so a reader who cannot tell red from amber
// still sees which of the three a message is.
import { describe, expect, test } from "bun:test";
import { rowMessage, rowMessageParts, type MessageVariant } from "../../../src/render/ui/components";

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

// spec 442: the row's own text is capitalized once, at render time,
// after every part is joined — never the message catalog, which stays
// lowercase because its entries are reused both standalone and mid-sentence.
describe("rowMessage/rowMessageParts capitalize their rendered text (spec 442)", () => {
  test("rowMessage capitalizes a lowercase-starting sentence", () => {
    expect(rowMessage("failed", "archive merge failed: cannot merge into main")).toContain(
      "Archive merge failed: cannot merge into main",
    );
  });

  test("rowMessageParts capitalizes EACH joined part independently, not only the first", () => {
    const html = rowMessageParts("failed", [{ text: "push failed" }, { text: "landing failed" }]);
    expect(html).toContain("Push failed");
    expect(html).toContain("Landing failed");
  });
});

// spec 493: a part that asks for a line of its own is its own box.
describe("rowMessageParts — an `own` part is its own box (spec 493)", () => {
  test("a single box is drawn exactly as before", () => {
    const html = rowMessageParts("waiting", [{ text: "a" }, { text: "b" }]);
    expect(html).not.toContain("msgstack");
    expect(html).toContain("A · B");
  });

  test("own parts stand alone with their own variant; the rest join", () => {
    const html = rowMessageParts("failed", [
      { text: "push failed", variant: "failed" },
      { text: "landing failed", variant: "failed" },
      { text: "held back", variant: "waiting", own: true },
      { text: "test server", variant: "waiting", own: true },
    ]);
    expect(html).toContain("msgstack");
    expect(html.match(/class="rowmsg /g)?.length).toBe(3);
    expect(html).toContain("Push failed · Landing failed");
    expect(html).toMatch(/class="rowmsg waiting">[\s\S]*Held back/);
    expect(html).not.toContain("Held back · ");
  });

  test("a part's lead control goes inside its box and its `after` content under it", () => {
    const html = rowMessageParts("waiting", [
      { text: "held back", own: true, lead: "<a id=lead></a>", after: "<p id=under></p>" },
      { text: "server", own: true },
    ]);
    expect(html).toMatch(/<div class="rowmsg waiting"><a id=lead><\/a>/);
    expect(html.indexOf("id=under")).toBeGreaterThan(html.indexOf("Held back"));
    expect(html.indexOf("id=under")).toBeLessThan(html.indexOf("Server"));
  });
});
