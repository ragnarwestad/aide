// The `- **Workflow steps completed:**` line of a 4-status.md is read once in
// bash (`workflow_steps_in` in core/scripts/lib/spec-state.sh) and once in
// TypeScript (`parseStatus(...).workflowSteps`). Both run here on one table
// of files.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseStatus } from "../../../src/project/parse-status";
import { workflowArc } from "../../../src/workflow-steps.ts";

const LIB = join(import.meta.dir, "..", "..", "..", "..", "core", "scripts", "lib", "spec-state.sh");
const ARC = workflowArc().map((step) => step.name);

/** What bash `workflow_steps_in` prints for `text`, read from standard input or as a file. */
const bash = (text: string, from: "stdin" | "file" = "stdin"): { ok: boolean; lines: string[] } => {
  const script =
    from === "stdin"
      ? 'source "$1"; printf "%s" "$2" | workflow_steps_in'
      : 'source "$1"; f="$(mktemp)"; printf "%s" "$2" > "$f"; workflow_steps_in "$f"; rc=$?; rm -f "$f"; exit $rc';
  const run = Bun.spawnSync({ cmd: ["bash", "-c", `set -u -o pipefail; ${script}`, "_", LIB, text], stdout: "pipe" });
  const out = run.stdout.toString();
  return { ok: run.exitCode === 0, lines: out === "" ? [] : out.replace(/\n$/, "").split("\n") };
};

const file = (...lines: string[]) => ["# 744 - Status", "", "## Tracking info", "", ...lines, ""].join("\n");

describe("workflow_steps_in", () => {
  test("prints the last bullet's steps, one per line, trimmed and lower-cased (AC-3)", () => {
    const text = file("- **Workflow steps completed:** create", "-  **Workflow Steps Completed:** `Create`, Analyze ,implement");
    for (const from of ["stdin", "file"] as const) {
      expect(bash(text, from)).toEqual({ ok: true, lines: ["create", "analyze", "implement"] });
    }
  });

  test("prints nothing and succeeds for a file without the line (AC-3)", () => {
    expect(bash(file("- **Task:** x"))).toEqual({ ok: true, lines: [] });
    expect(bash(file("- **Task:** x"), "file")).toEqual({ ok: true, lines: [] });
  });
});

describe("the Workflow steps line reads the same on both sides", () => {
  const TABLE: Array<[string, string]> = [
    ["one bullet", file("- **Workflow steps completed:** create, analyze")],
    ["spaces after the dash", file("-   **Workflow steps completed:** create, analyze, implement")],
    ["backticks", file("- **Workflow steps completed:** `create`, `analyze`")],
    ["mixed letter case", file("- **WORKFLOW steps Completed:** Create, ANALYZE")],
    ["two bullets", file("- **Workflow steps completed:** create", "- **Workflow steps completed:** create, analyze, implement")],
    ["no bullet", file("- **Task:** x")],
    ["the label inside a sentence", file("The **Workflow steps completed:** create, analyze line is written by the runner.")],
    ["a word that is not a step", file("- **Workflow steps completed:** create, explore, analyse, analyze")],
  ];

  for (const [what, text] of TABLE) {
    test(`${what} (AC-5)`, () => {
      const fromBash = bash(text).lines;
      expect(ARC.filter((step) => fromBash.includes(step))).toEqual(parseStatus(text).workflowSteps);
    });
  }
});
