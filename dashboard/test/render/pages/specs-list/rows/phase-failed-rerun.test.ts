// A step whose newest run failed reads Failed on the row and the spec page,
// though an earlier run finished it. The rule is proven in
// job-state/word-phase-failed.test.ts; this proves the row is wired to it.
import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type SpecTarget } from "../../../../../src/render";
import { openKeys, row } from "../../fixtures.ts";

const FOLDER = "564-a-refused-analysis";

const render = (list: ReturnType<typeof row>[], target: SpecTarget) =>
  renderSpecsRows(list, { runnerAvailable: true, targets: [target], filter: { open: openKeys(list, [target]) } });
const analyzeLine = (html: string) =>
  html.match(/<tr class="subrow[^"]*"[^>]*data-step="analyze">.*?<\/tr>/)?.[0] ?? "";
const box = (html: string, step: string) =>
  html.match(new RegExp(`<input type="checkbox" name="steps"[^>]*value="${step}"[^>]*>`))?.[0] ?? "";

describe("a failed newest run is drawn as failed (AC-1)", () => {
  // What the workflow state hands the row when analysis was refused: the
  // done list no longer names it, and the history carries the reason.
  const refused: SpecTarget = {
    project: "aide",
    specFolder: FOLDER,
    done: ["create"],
    stopped: { analyze: "model-refused" },
  };

  test("the analyze line reads Failed, the button offers Analyze and Analyze is ticked (AC-1)", () => {
    const html = render([], refused);
    expect(analyzeLine(html)).toContain("b-refused");
    expect(analyzeLine(html)).toContain(">Failed<");
    expect(html).toMatch(/class="btn primary"[^>]*>Analyze<\/button>/);
    expect(box(html, "analyze")).toContain("checked");
  });

  test("a failed job over an analysis the files name as done draws Failed on the line (AC-1)", () => {
    const failed = row({
      id: "j1",
      specFolder: FOLDER,
      steps: ["analyze"],
      state: "failed",
      results: [{ step: "analyze", ok: false, costUsd: 0 }],
    });
    const html = render([failed], { project: "aide", specFolder: FOLDER, done: ["create", "analyze"] });
    expect(analyzeLine(html)).toContain(">Failed<");
    expect(analyzeLine(html)).not.toContain("b-done");
  });
});
