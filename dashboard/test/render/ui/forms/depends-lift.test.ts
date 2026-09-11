// Spec 404, REQ-3: the two halves are one control — ticking a box in
// the list below lifts its chip to the picked block, and unticking it
// drops it back, without waiting for the form to be saved.
//
// `depends-lift.ts` can neither import nor export anything (the shell
// transpiles it into an inline classic script), so it is transpiled and
// run here against a document small enough to state in full, the same
// way nav-busy.test.ts does.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
  readFileSync(join(import.meta.dir, "..", "..", "..", "..", "src", "render", "ui", "forms", "depends-lift.ts"), "utf-8"),
);

/** The two blocks and one chip in each, as the page renders them. */
function harness(checked: boolean, chipIn: "picked" | "rest") {
  const picked = { className: "phases picked", children: [] as unknown[], appendChild(c: unknown) { this.children.push(c); } };
  const rest = { className: "phases", children: [] as unknown[], appendChild(c: unknown) { this.children.push(c); } };
  const field = {
    querySelector: (sel: string) => (sel === ".phases.picked" ? picked : sel === ".phases:not(.picked)" ? rest : null),
  };
  const chip: Record<string, unknown> = { closest: (sel: string) => (sel === ".field" ? field : null) };
  chip.parentElement = chipIn === "picked" ? picked : rest;
  (chipIn === "picked" ? picked : rest).children.push(chip);
  const box = {
    name: "dependsOn",
    checked,
    closest: (sel: string) => (sel === "[data-project]" ? chip : null),
  };
  let handler: ((e: unknown) => void) | undefined;
  const document = { addEventListener: (_: string, h: (e: unknown) => void) => void (handler = h) };
  new Function("document", SOURCE)(document);
  return { fire: () => handler?.({ target: box }), picked, rest, chip };
}

describe("ticking a dependency moves its chip at once (spec 404, REQ-3)", () => {
  test("a box ticked in the list below lifts its chip to the picked block", () => {
    const h = harness(true, "rest");
    h.fire();
    expect(h.picked.children).toContain(h.chip);
  });

  test("a box unticked in the picked block drops its chip back to the list", () => {
    const h = harness(false, "picked");
    h.fire();
    expect(h.rest.children).toContain(h.chip);
  });

  test("a chip already in the right block is left alone", () => {
    const h = harness(true, "picked");
    h.fire();
    expect(h.picked.children.filter((c) => c === h.chip)).toHaveLength(1);
  });

  // A locked chip — an archived dependency — carries no name, so it
  // never matches and cannot be moved.
  test("a box that is not a dependency box is ignored", () => {
    const other = { name: "steps", checked: true, closest: () => null };
    const document = { addEventListener: (_: string, fn: (e: unknown) => void) => fn({ target: other }) };
    expect(() => new Function("document", SOURCE)(document)).not.toThrow();
  });
});
