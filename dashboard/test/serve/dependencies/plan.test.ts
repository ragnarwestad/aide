import { expect, test } from "bun:test";
import { planDependencies } from "../../../src/serve/dependencies/plan.ts";

const description = (...deps: string[]) => `# X\n\n## Tracking info\n\n- **Created:** now\n- **Depends on:** ${deps.map((d) => `\`${d}\``).join(", ")}\n`;

test("preserves existing dependencies and adds each new target once", () => {
  const graph = new Map([["1-a", description("2")], ["2-b", description()], ["3-c", description()]]);
  expect(planDependencies("1-a", ["2-b", "3-c", "3-c"], graph))
    .toEqual({ dependencies: ["2", "3-c"], added: ["3-c"] });
});

test("refuses a cycle through the entire dependency chain without changing the graph", () => {
  const graph = new Map([["1-a", description()], ["2-b", description("3")], ["3-c", description("1")]]);
  expect(planDependencies("1-a", ["2-b"], graph)).toEqual({ cycle: ["1-a", "2-b", "3-c", "1-a"] });
  expect(graph.get("1-a")).toBe(description());
});

test("refuses self-dependency and rejects a whole batch when one target closes a cycle", () => {
  const graph = new Map([["1-a", description()], ["2-b", description()], ["3-c", description("1")]]);
  expect(planDependencies("1-a", ["1-a"], graph)).toEqual({ cycle: ["1-a", "1-a"] });
  expect(planDependencies("1-a", ["2-b", "3-c"], graph)).toEqual({ cycle: ["1-a", "3-c", "1-a"] });
});

test("shared downstream dependencies are not cycles", () => {
  const graph = new Map([["1-a", description("2")], ["2-b", description("4")], ["3-c", description("4")], ["4-d", description()]]);
  expect(planDependencies("1-a", ["3-c"], graph)).toEqual({ dependencies: ["2", "3-c"], added: ["3-c"] });
});

test("does not guess when a dependency is missing or its number is ambiguous", () => {
  const graph = new Map([["1-a", description()], ["2-b", description()], ["2-c", description()]]);
  expect(planDependencies("1-a", ["2"], graph)).toHaveProperty("error");
  expect(planDependencies("1-a", ["missing"], graph)).toHaveProperty("error");
});
