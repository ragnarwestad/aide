import { describe, expect, test } from "bun:test";
import { type MessageEntry, type MessageKey } from "../../src/messages/catalog.ts";
import { formatMessage, formatSentence, type BoardMessage } from "../../src/messages/format.ts";

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
    expect(formatMessage("en", m("t.lines", { values: { branch: "aide/1-x" } }), CATALOG)).toBe(
      "Problem: The push of aide/1-x was refused\nSolution: Press Archive again",
    );
  });

  test("labels both lines in the reader's language", () => {
    expect(formatMessage("nb", m("t.lines", { values: { branch: "aide/1-x" } }), CATALOG)).toBe(
      "Problem: Pushen av aide/1-x ble avvist\nLøsning: Trykk Arkiver igjen",
    );
  });

  test("with nothing to resolve is the Problem line alone", () => {
    expect(formatMessage("en", m("t.noFix"), CATALOG)).toBe("Problem: The spec is archived");
  });

  test("takes only the problem of the message inside it, and that message's fix when it has none of its own", () => {
    expect(formatMessage("en", m("t.wrapper", { inner: m("t.lines", { values: { branch: "b" } }) }), CATALOG)).toBe(
      "Problem: Archive merge failed: the push of b was refused\nSolution: Press Archive again",
    );
  });

  test("keeps its own fix over the fix of the message inside it", () => {
    expect(
      formatMessage("en", m("t.wrapperWithFix", { values: { title: "X" }, inner: m("t.lines", { values: { branch: "b" } }) }), CATALOG),
    ).toBe("Problem: Creating X failed: the push of b was refused\nSolution: Press Try again, then press Create");
  });

  test("several messages with one fix share one Solution line", () => {
    const two = [m("t.lines", { values: { branch: "a" } }), m("t.lines", { values: { branch: "b" } })];
    expect(formatSentence("en", two, CATALOG)).toBe(
      "Problem: The push of a was refused. The push of b was refused\nSolution: Press Archive again",
    );
  });

  test("several messages with different fixes are a Problem and a Solution line each", () => {
    expect(formatSentence("en", [m("t.lines", { values: { branch: "a" } }), m("t.noFix")], CATALOG)).toBe(
      "Problem: The push of a was refused\nSolution: Press Archive again\nProblem: The spec is archived",
    );
  });
});

describe("a message not yet in the two-line shape", () => {
  test("reads exactly as it was written", () => {
    expect(formatMessage("en", m("t.legacy"), CATALOG)).toBe("held back — press Analyze first");
  });

  test("keeps a two-line message inside it whole, fix and all", () => {
    const legacyWrapper = { ...CATALOG, "t.oldWrapper": { ...all("archive failed: {message}"), exempt: "x" } } as unknown as Record<string, MessageEntry>;
    expect(formatMessage("en", m("t.oldWrapper", { inner: m("t.lines", { values: { branch: "b" } }) }), legacyWrapper)).toBe(
      "archive failed: the push of b was refused — press Archive again",
    );
  });
});

describe("information keeps its meaning when given a lead", () => {
  test("a statement is still information with a phase name before it", () => {
    const text = formatMessage("en", m("message.lead", {
      values: { lead: "Analyze" }, inner: m("runner.dependencyNotArchived", { values: { dependency: "aide:726" } }),
    }));
    expect(text).toStartWith("Analyze ");
    expect(text).not.toMatch(/^(Problem|Solution):/m);
  });
});


test("information beside an error keeps its own unlabelled line", () => {
  const info = m("runner.dependencyNotArchived", { values: { dependency: "aide:726" } });
  const text = formatSentence("en", [m("runner.notAnalyzed"), info])!;
  expect(text.split("\n")).toContain(formatMessage("en", info));
});


test("a lead does not reclassify an older error stored as plain text", () => {
  const text = formatMessage("en", m("message.lead", { values: { lead: "Analyze" }, inner: "legacy failure" }));
  expect(text).toStartWith("Problem:");
});

test("a failed step's information keeps its meaning with the step name before it (AC-1)", () => {
  const stored = m("runner.stepFailed", {
    values: { step: "analyze", button: "Analyze" }, inner: m("runner.shortAnalysisOverLimit", { values: { button: "Analyze" } }),
  });
  const text = formatMessage("en", stored);
  expect(text).not.toMatch(/^(Problem|Solution):/m);
  expect(text).toContain(formatMessage("en", stored.inner as BoardMessage).replace(/^./, (c) => c.toLowerCase()));
});
