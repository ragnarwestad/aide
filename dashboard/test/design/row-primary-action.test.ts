// The primary button on a spec's row names the phase a press would run,
// and a running job offers Cancel alone.
import { describe, expect, test } from "bun:test";
import type { SpecsPageOptions } from "../../src/render";
import { row, rows, target } from "./row-fixtures.ts";

// --- the button says what pressing it does ------------------------------------

describe("the primary button's label per row state (the design sheet's table)", () => {
  const buttons = (html: string) =>
    [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
      m[1]!.replace(/<[^>]*>/g, "").trim(),
    );

  test("a spec nothing has ever run is offered its first two phases", () => {
    expect(buttons(rows([], { targets: [target()] }))).toContain("Analyze");
  });

  // The bare word "Run" went in spec 157, and "Run again" before it
  // (2026-08-19): the again-variant guessed at history and guessed
  // wrong at the edges. The button names the phase a press would run,
  // which is the thing both wordings were groping for.
  test("the button names the phase a press would run, whatever has already run", () => {
    for (const [done, label] of [
      [[], "Analyze"],
      [["analyze"], "Implement"],
      [["analyze", "implement"], "Archive"],
    ] as const) {
      const t = target({ done: [...done] });
      const b = buttons(rows([row({ state: "done" })], { targets: [t] }));
      expect(b).toContain(label);
      expect(b).not.toContain("Run again");
      expect(b).not.toContain("Run");
    }
  });

  test("a running job offers Cancel and nothing else", () => {
    const html = rows([row({ state: "running" })], { targets: [target()] });
    // Named for the step it would stop, so it reads like the Run
    // button it replaces (spec 157).
    expect(buttons(html)).toContain("Cancel");
    // No Run at all — a greyed-out one beside a live Cancel is the
    // second control this spec removes. The busy VARIANT carries a
    // spinner, and the running phase chip already has the row's one;
    // two spinners read as two jobs (2026-08-19).
    expect(html).not.toMatch(/<button[^>]*form="rowrun/);
    expect(html).not.toContain(">Run<");
    const cancel = html.match(/<button[^>]*>Cancel<\/button>/)?.[0] ?? "";
    expect(cancel).not.toContain("busy");
  });
});

// --- spec 171: a conflict is archive's to resolve ---------------------------
//
// A conflict that reaches a reader is one no machine could settle, and
// the row says so in the failure's own text beside the ordinary re-run
// every other failed step offers.

describe("a conflict refusal (spec 171)", () => {
  const CONFLICT = {
    error: "cannot merge aide/102 into main in /repos/aide (conflict)",
    errorReason: "conflict" as const,
  };

  const conflicted = (opts: Partial<SpecsPageOptions> = {}) =>
    rows([row({ state: "done", ...CONFLICT })], { targets: [target()], ...opts });

  test("offers the ordinary re-run, the same control every other failed step's row carries", () => {
    const html = conflicted();
    expect(html).toMatch(/<button[^>]*form="rowrun/);
  });
});
