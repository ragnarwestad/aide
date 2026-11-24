// The TypeScript measurer and the held comparison, on small snippets:
// function length and nesting, repeated blocks, and the rule that held
// code fails only when it gets worse.
import { describe, expect, test } from "bun:test";
import { duplicateFailures, duplicates, functionFailures, MAX_DEPTH, MAX_LINES, tsFunctions } from "./measure.ts";

const statements = (count: number, indent = "  ") =>
  Array.from({ length: count }, (_, i) => `${indent}const v${i} = ${i};`).join("\n");

// Five control blocks deep, and braces in a string, a template, a comment
// and a regular expression that open nothing: 15 lines.
const DEEP_BODY = [
  '  const s = "{ {";',
  "  const t = `${s} { ${'{'}`; // {",
  "  /* { */ const r = /\\{[{]/;",
  "  if (s) {",
  "    for (const x of [s, t]) {",
  "      while (x) {",
  "        try {",
  "          switch (x) {",
  "            case r.source: { break; }",
  "          }",
  "        } catch {",
  "        }",
  "      }",
  "    }",
  "  } else if (t) {",
  "  }",
].join("\n");

const deepFunction = (header: string, closer = "}") =>
  `${header}\n${DEEP_BODY}\n${statements(MAX_LINES + 1 - 18)}\n${closer}\n`;

describe("the TypeScript measurer", () => {
  test("a declaration, an arrow and a method five blocks deep and 61 lines long are measured (AC-1)", () => {
    const source = [
      deepFunction("export function deepDeclaration(a: string[]): void {"),
      deepFunction("const deepArrow = async (a: string[]): Promise<void> => {", "};"),
      "class Holder {",
      deepFunction("  private method(a: Map<string, number>): void {", "  }"),
      "}",
    ].join("\n");
    const measured = tsFunctions(source);
    for (const name of ["deepDeclaration", "deepArrow", "method"]) {
      expect(measured[name]).toEqual({ lines: 61, depth: 5 });
    }
    const failures = functionFailures({ "a.ts::deepArrow": measured.deepArrow! }, {});
    expect(failures).toHaveLength(2);
    expect(failures.join("\n")).toContain(`limit ${MAX_LINES}`);
    expect(failures.join("\n")).toContain(`limit ${MAX_DEPTH}`);
  });

  test("a describe callback's length is not measured, and a long test inside it is (AC-1)", () => {
    const source = [
      'describe("group", () => {',
      '  test("short", () => { expect(1).toBe(1); });',
      '  test("long", () => {',
      statements(MAX_LINES - 1, "    "),
      "  });",
      statements(200, "  "),
      "});",
    ].join("\n");
    const failures = functionFailures(
      Object.fromEntries(Object.entries(tsFunctions(source)).map(([key, value]) => [`a.test.ts::${key}`, value])),
      {},
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("a.test.ts::describe(group).test(long): 61 lines");
  });

  test("a test keeps its key when another test is added before it (AC-2)", () => {
    const long = `  test("long", () => {\n${statements(MAX_LINES + 5, "    ")}\n  });`;
    const before = tsFunctions(`describe("group", () => {\n${long}\n});`);
    const after = tsFunctions(`describe("group", () => {\n  test("new", () => {});\n${long}\n});`);
    expect(before["describe(group).test(long)"]!.lines).toBe(MAX_LINES + 7);
    expect(after["describe(group).test(long)"]).toEqual(before["describe(group).test(long)"]!);
  });

  test("a return type written as an object is not taken for the body (AC-1)", () => {
    const source = `function f(): { value: number } {\n${statements(MAX_LINES + 6)}\n  return { value: 1 };\n}\n`;
    const typed = `const g = (): Promise<{ a: number }> => {\n${statements(3)}\n};\n`;
    const measured = tsFunctions(source + typed);
    expect(measured.f).toEqual({ lines: MAX_LINES + 9, depth: 0 });
    expect(measured.g).toEqual({ lines: 5, depth: 0 });
  });

  test("each anonymous function is checked against its own held level (AC-2)", () => {
    const source = [
      "function outer() {",
      `  run(() => {\n${statements(68, "    ")}\n  });`,
      `  run(function () {\n${statements(63, "    ")}\n  });`,
      "}",
    ].join("\n");
    const measured = Object.fromEntries(
      Object.entries(tsFunctions(source)).map(([key, value]) => [`a.ts::${key}`, value]),
    );
    expect(measured["a.ts::outer.<anonymous#1>"]!.lines).toBe(70);
    expect(measured["a.ts::outer.<anonymous#2>"]!.lines).toBe(65);
    const held = { "a.ts::outer.<anonymous#1>": { lines: 70 }, "a.ts::outer.<anonymous#2>": { lines: 30 } };
    const failures = functionFailures(measured, held);
    expect(failures.filter((line) => line.includes("<anonymous"))).toEqual([
      expect.stringContaining("a.ts::outer.<anonymous#2>: 65 lines (recorded 30)"),
    ]);
  });
});

const shared = (count: number) => Array.from({ length: count }, (_, i) => `  total += weigh(${i}, "shared");`);

describe("repeated blocks in TypeScript", () => {
  test("eight shared lines are reported in both files, seven are not, and comments and closers do not count (AC-1)", () => {
    const padded = shared(8).flatMap((line) => [line, "", "  // note", "  });"]);
    const found = duplicates({
      "a.ts": ["import a;", ...shared(8)].join("\n"),
      "b.ts": padded.join("\n"),
      "c.ts": shared(7).join("\n"),
    });
    expect(Object.keys(found).sort()).toEqual(["a.ts", "b.ts"]);
    expect(found["a.ts"]).toEqual([[2, "b.ts", 1]]);
    expect(duplicates({ "c.ts": shared(7).join("\n"), "d.ts": ["x();", ...shared(7)].join("\n") })).toEqual({});
  });

  test("a copied block raises the file it came from and the one it went to (AC-2)", () => {
    const found = duplicates({ "a.ts": shared(8).join("\n"), "b.ts": ["start();", ...shared(8)].join("\n") });
    const failures = duplicateFailures(found, {});
    expect(failures).toHaveLength(2);
    expect(failures[0]).toStartWith("a.ts: 1 ");
    expect(failures[1]).toStartWith("b.ts: 1 ");
  });
});

describe("the held comparison", () => {
  test("held code fails only when it gets worse, and a gone entry reports nothing (AC-2)", () => {
    const held = { "a.ts::f": { lines: 74, depth: 5 }, "a.ts::gone": { lines: 90 } };
    expect(functionFailures({ "a.ts::f": { lines: 74, depth: 5 } }, held)).toEqual([]);
    expect(functionFailures({ "a.ts::f": { lines: 60, depth: 2 } }, held)).toEqual([]);
    const failures = functionFailures({ "a.ts::f": { lines: 75, depth: 5 } }, held);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("75 lines (recorded 74)");
    const found = { "a.ts": [[1, "b.ts", 1], [5, "b.ts", 9]] as [number, string, number][] };
    expect(duplicateFailures(found, { "a.ts": 2 })).toEqual([]);
    expect(duplicateFailures(found, { "a.ts": 1 })).toHaveLength(1);
    expect(duplicateFailures({}, { "gone.ts": 3 })).toEqual([]);
  });
});
