// A provider's short name: the two characters the pickers show beside its
// tool's icon. Made from the name, unique among providers, and checked when
// a person types one.

import { describe, expect, test } from "bun:test";
import {
  freeShortName,
  shortNameError,
  shortNameFrom,
  shortNameHolder,
  withShortNames,
} from "../../../src/queue/providers/short-name.ts";
import type { Provider } from "../../../src/queue/providers/index.ts";

describe("a short name made from a name", () => {
  test("the first letters of the first two words, or the first two letters of one word, in capitals (AC-1)", () => {
    expect(shortNameFrom("Claude Personal")).toBe("CP");
    expect(shortNameFrom("Codex")).toBe("CO");
    expect(shortNameFrom("opencode zen")).toBe("OZ");
    expect(shortNameFrom("  Claude   Personal Work ")).toBe("CP");
  });

  test("letters another provider has take a digit in place of the second, from 2 on (AC-9)", () => {
    expect(freeShortName("Claude Personal", [])).toBe("CP");
    expect(freeShortName("Codex Pro", ["cp"])).toBe("C2");
    expect(freeShortName("Coder", ["CO"])).toBe("C2");
    expect(freeShortName("Cobalt", ["CO", "C2"])).toBe("C3");
    expect(freeShortName("A", [])).toBe("A2");
  });

  test("once every pair starting with the name's first letter is taken, another free pair is given (AC-2)", () => {
    const providers: Record<string, Provider> = {};
    for (let i = 0; i < 40; i++) providers[`c${i}`] = { name: `C${"x".repeat(i + 1)}`, tool: "claude" };
    const shorts = Object.values(withShortNames(providers)).map((p) => p.short);
    expect(new Set(shorts).size).toBe(40);
  });
});

describe("a short name a person types", () => {
  test("two characters pass; one, three or none are refused with a sentence that says why (AC-4)", () => {
    expect(shortNameError("XY")).toBeNull();
    expect(shortNameError(" x9 ")).toBeNull();
    expect(shortNameError("X")).toContain("two characters");
    expect(shortNameError("XYZ")).toContain("two characters");
    expect(shortNameError("")).toContain("two characters");
    expect(shortNameError("X ")).toContain("two characters");
  });

  test("the provider holding a short name is found in any case, leaving out the one being edited (AC-4)", () => {
    const providers: Record<string, Provider> = {
      Personal: { name: "Claude Personal", short: "CP", tool: "claude" },
      Codex: { name: "Codex", short: "CO", tool: "codex" },
    };
    expect(shortNameHolder(providers, "cp")).toBe("Claude Personal");
    expect(shortNameHolder(providers, "CP", "Personal")).toBeUndefined();
    expect(shortNameHolder(providers, "ZZ")).toBeUndefined();
  });
});

describe("a table read without short names", () => {
  test("every provider gets one made from its name, and no two are the same (AC-2)", () => {
    const out = withShortNames({
      a: { name: "Claude Personal", tool: "claude" },
      b: { name: "Claude Pro", tool: "claude" },
      c: { name: "Codex", tool: "codex" },
    });
    expect(Object.values(out).map((p) => p.short)).toEqual(["CP", "C2", "CO"]);
  });

  test("a stored short name claims its letters before a made one, even from later in the table (AC-2, AC-9)", () => {
    const out = withShortNames({
      codex: { name: "Codex", tool: "codex" },
      later: { name: "Other", short: "CO", tool: "codex" },
    });
    expect(out.codex?.short).toBe("C2");
    expect(out.later?.short).toBe("CO");
  });

  test("names whose letters are taken get the next free digit in config order (AC-9)", () => {
    const out = withShortNames({
      codex: { name: "Codex", short: "CO", tool: "codex" },
      coder: { name: "Coder", tool: "codex" },
      cobalt: { name: "Cobalt", tool: "codex" },
    });
    expect([out.coder?.short, out.cobalt?.short]).toEqual(["C2", "C3"]);
  });

  test("a later provider with a stored short name an earlier one has stored gets another (AC-2)", () => {
    const out = withShortNames({
      a: { name: "Alpha", short: "XY", tool: "claude" },
      b: { name: "Beta", short: "xy", tool: "codex" },
    });
    expect(out.a?.short).toBe("XY");
    expect(out.b?.short).toBe("BE");
  });
});
