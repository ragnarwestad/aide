import { describe, expect, test } from "bun:test";
import type { MessageEntry, MessageKey } from "./messages.ts";
import { renderMessage, renderSentence, type BoardMessage } from "./message.ts";

const all = (s: string) => ({ en: s, nb: s, es: s, de: s, fr: s });

/** A catalog of its own, so the rule is proven on entries in each shape
 *  whatever the board's own entries hold. */
const CATALOG = {
  "t.lines": { ...all("the push of {branch} was refused"), nb: "pushen av {branch} ble avvist", solution: { ...all("press Archive again"), nb: "trykk Arkiver igjen" } },
  "t.noFix": { ...all("the spec is archived"), solution: null, exempt: "a fact, nothing to put right" },
  "t.wrapper": { ...all("archive merge failed: {message}"), solution: null, exempt: "the message inside it knows the fix" },
  "t.wrapperWithFix": { ...all("creating {title} failed: {message}"), solution: all("press Try again, then press Create") },
  "t.legacy": { ...all("held back — press Analyze first"), resolve: "press Analyze first" },
} as unknown as Record<string, MessageEntry>;

const m = (key: string, rest: Omit<BoardMessage, "key"> = {}): BoardMessage => ({ key: key as MessageKey, ...rest });

describe("a message in the two-line shape", () => {
  test("is a Problem line and a Solution line, each opening with a capital", () => {
    expect(renderMessage("en", m("t.lines", { values: { branch: "aide/1-x" } }), CATALOG)).toBe(
      "Problem: The push of aide/1-x was refused\nSolution: Press Archive again",
    );
  });

  test("labels both lines in the reader's language", () => {
    expect(renderMessage("nb", m("t.lines", { values: { branch: "aide/1-x" } }), CATALOG)).toBe(
      "Problem: Pushen av aide/1-x ble avvist\nLøsning: Trykk Arkiver igjen",
    );
  });

  test("with nothing to resolve is the Problem line alone", () => {
    expect(renderMessage("en", m("t.noFix"), CATALOG)).toBe("Problem: The spec is archived");
  });

  test("takes only the problem of the message inside it, and that message's fix when it has none of its own", () => {
    expect(renderMessage("en", m("t.wrapper", { inner: m("t.lines", { values: { branch: "b" } }) }), CATALOG)).toBe(
      "Problem: Archive merge failed: the push of b was refused\nSolution: Press Archive again",
    );
  });

  test("keeps its own fix over the fix of the message inside it", () => {
    expect(
      renderMessage("en", m("t.wrapperWithFix", { values: { title: "X" }, inner: m("t.lines", { values: { branch: "b" } }) }), CATALOG),
    ).toBe("Problem: Creating X failed: the push of b was refused\nSolution: Press Try again, then press Create");
  });

  test("several messages with one fix share one Solution line", () => {
    const two = [m("t.lines", { values: { branch: "a" } }), m("t.lines", { values: { branch: "b" } })];
    expect(renderSentence("en", two, CATALOG)).toBe(
      "Problem: The push of a was refused. The push of b was refused\nSolution: Press Archive again",
    );
  });

  test("several messages with different fixes are a Problem and a Solution line each", () => {
    expect(renderSentence("en", [m("t.lines", { values: { branch: "a" } }), m("t.noFix")], CATALOG)).toBe(
      "Problem: The push of a was refused\nSolution: Press Archive again\nProblem: The spec is archived",
    );
  });
});

describe("a message not yet in the two-line shape", () => {
  test("reads exactly as it was written", () => {
    expect(renderMessage("en", m("t.legacy"), CATALOG)).toBe("held back — press Analyze first");
  });

  test("keeps a two-line message inside it whole, fix and all", () => {
    const legacyWrapper = { ...CATALOG, "t.oldWrapper": { ...all("archive failed: {message}"), exempt: "x" } } as unknown as Record<string, MessageEntry>;
    expect(renderMessage("en", m("t.oldWrapper", { inner: m("t.lines", { values: { branch: "b" } }) }), legacyWrapper)).toBe(
      "archive failed: the push of b was refused — press Archive again",
    );
  });
});

describe("the board's own entries", () => {
  test("an entry is a Problem line and a Solution line in the reader's language (AC-1)", () => {
    expect(renderMessage("nb", m("runner.notAnalyzed"))).toBe(
      "Problem: Holdt tilbake: ikke analysert ennå\nLøsning: Trykk Analyser først",
    );
  });

  test("an entry that offered two fixes names the one that resolves the case (AC-2)", () => {
    expect(renderMessage("en", m("runner.modelAtCapacity", { values: { button: "Analyze" } })).split("\n")[1]).toBe(
      "Solution: Press Analyze again",
    );
  });

  test("a wrapper takes the fix of the message inside it (AC-3)", () => {
    const inner = m("runner.notAnalyzed");
    const out = renderMessage("en", m("landing.stepFailed", { values: { step: "Archive" }, inner }));
    expect(out.split("\n")[1]).toBe("Solution: Press Analyze first");
  });

  test("an entry around data keeps its own fix (AC-3)", () => {
    const out = renderMessage("en", m("runner.criteriaStopped", { values: { message: "x" } }));
    expect(out.split("\n")).toHaveLength(2);
  });

  test("a runner's English words with their fix are the two lines (AC-4)", () => {
    expect(
      renderMessage("nb", m("message.written", { values: { problem: "cannot fast-forward b", solution: "merge it by hand" } })),
    ).toBe("Problem: Cannot fast-forward b\nLøsning: Merge it by hand");
  });

  test("a runner's words without a fix are the Problem line alone (AC-4)", () => {
    expect(renderMessage("en", m("message.written", { values: { problem: "cannot do x", solution: "" } }))).toBe(
      "Problem: Cannot do x",
    );
  });

  test("a message stored as plain text reads exactly as stored (AC-5)", () => {
    expect(renderSentence("nb", "cannot do x — fix y")).toBe("cannot do x — fix y");
  });
});
