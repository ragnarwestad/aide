// The line that says which workflow steps a spec has had, and the model
// each step ran on.
//
// Split out of parse-status-fields.test.ts 2026-09-04; the tests are
// unchanged and keep their names.

// Split out of parse-status.test.ts by theme.
//
// Criteria 2-3: every observed progress-line variant parses (fixtures
// are copies of REAL status files from aide-specs and paceup); a file
// without a recognizable line yields unknown progress; the phase is
// the first phase section with unchecked tasks.

import { describe, expect, test } from "bun:test";
import { archiveHeldBackReason, parseStatus } from "../../src/project/parse-status.ts";


// Until now the dashboard GUESSED which workflow steps a spec had had,
// from the size of 2-analysis.md, a heading in 3-solution.md and the
// percentage in 4-status.md. All three are proxies for the question,
// and the first of them broke on 2026-08-20: spec 138's untouched
// analysis template is 693 bytes, so it read as analysed before any
// analyze had run. The steps now SAY so, on one line of 4-status.md,
// and this parses it.
describe("spec 139: workflow steps completed", () => {
  const withField = (value: string) =>
    ["# 139 - Status", "", "## Tracking info", "", `- **Workflow steps completed:** ${value}`, ""].join("\n");

  test("the canonical line comes back as its list (criterion 1)", () => {
    expect(parseStatus(withField("create, analyze, implement")).workflowSteps).toEqual([
      "create",
      "analyze",
      "implement",
    ]);
  });

  test("a freshly created spec has had exactly create (criterion 1)", () => {
    expect(parseStatus(withField("create")).workflowSteps).toEqual(["create"]);
  });

  test("no such field means nothing is known to have completed (criterion 4)", () => {
    expect(parseStatus("# 139 - Status\n\nProse only.\n").workflowSteps).toEqual([]);
  });

  test("an empty field is no completed step, not a blank one (criterion 4)", () => {
    expect(parseStatus(withField("")).workflowSteps).toEqual([]);
    expect(parseStatus(withField("none")).workflowSteps).toEqual([]);
  });

  test("unknown values are ignored (criterion 4)", () => {
    expect(parseStatus(withField("create, resolve, merge, analyze")).workflowSteps).toEqual([
      "create",
      "analyze",
    ]);
  });

  // `review-plan` was a step until spec 181 folded the review into
  // analyze. An archived spec's line still names it, and an unknown
  // value is dropped rather than shown as a step the workflow no
  // longer has.
  test("a spec archived before spec 181 keeps the four steps that remain", () => {
    expect(parseStatus(withField("create, analyze, review-plan, implement, archive")).workflowSteps).toEqual([
      "create",
      "analyze",
      "implement",
      "archive",
    ]);
  });

  test("duplicates collapse and the order is the workflow's, not the line's (criterion 4)", () => {
    expect(parseStatus(withField("implement, create, analyze, create")).workflowSteps).toEqual([
      "create",
      "analyze",
      "implement",
    ]);
  });

  test("backticks, case and stray spacing do not change the answer (criterion 4)", () => {
    expect(parseStatus(withField("`Create`,  ANALYZE ,implement")).workflowSteps).toEqual([
      "create",
      "analyze",
      "implement",
    ]);
  });

  test("archive is an allowed value — the archived file stays the whole record", () => {
    expect(parseStatus(withField("create, analyze, implement, archive")).workflowSteps).toEqual([
      "create",
      "analyze",
      "implement",
      "archive",
    ]);
  });

  // Criterion 9: the field is an ADDITION to 4-status.md. Everything the
  // parser already answered out of that file must answer the same.
  test("progress, phase and the held-back reason are untouched by the new field (criterion 9)", () => {
    const content = [
      "# 139 - Status",
      "",
      "## Tracking info",
      "",
      "- **Workflow steps completed:** create, analyze",
      "- **Total progress:** `95% (21 of 22 completed)`",
      "",
      "## Archive held back",
      "",
      "- the Slack webhook (Phase 4, still unchecked)",
      "",
      "## Phase 1: RED",
      "",
      "| Task | Status | Notes |",
      "|------|--------|-------|",
      "| a    | ⬜     |       |",
      "",
    ].join("\n");
    const status = parseStatus(content);
    expect(status.progress).toEqual({ percent: 95, done: 21, total: 22 });
    expect(status.phase).toBe("Phase 1: RED");
    expect(status.workflowSteps).toEqual(["create", "analyze"]);
    expect(archiveHeldBackReason(content)).toBe("the Slack webhook (Phase 4, still unchecked)");
  });

  // The line the old heuristics would have read as "analyze done": a
  // status file saying only `create`, beside an untouched 693-byte
  // analysis template. The parser answers from the field alone.
  test("the field is the only source — a long analysis nearby says nothing", () => {
    expect(parseStatus(withField("create") + "\n" + "Findings, at length. ".repeat(40)).workflowSteps).toEqual([
      "create",
    ]);
  });
});

// --- spec 244: what each phase actually ran on -------------------------------

// `aide-run-spec` has written one `- **Model (<step>):** <tool> [<model>]`
// line per completed workflow step since spec 217, beside the `Workflow
// steps completed` line above — and until now nothing read it back.
describe("spec 244: step models", () => {
  const withLine = (line: string) =>
    ["# 244 - Status", "", "## Tracking info", "", line, ""].join("\n");

  test("a recorded line comes back keyed by step (criterion 1)", () => {
    expect(parseStatus(withLine("- **Model (analyze):** claude claude-sonnet-5")).stepModels).toEqual({
      analyze: "claude claude-sonnet-5",
    });
  });

  test("a bare tool with no model id is kept as written", () => {
    expect(parseStatus(withLine("- **Model (create):** claude")).stepModels).toEqual({
      create: "claude",
    });
  });

  test("no such line at all means nothing is known (criterion 2)", () => {
    expect(parseStatus("# 244 - Status\n\nProse only.\n").stepModels).toEqual({});
  });

  test("an unknown or retired step name is dropped (criterion 3)", () => {
    expect(parseStatus(withLine("- **Model (review-plan):** claude")).stepModels).toEqual({});
  });

  test("nothing after the colon is dropped, not kept as an empty string (criterion 3)", () => {
    expect(parseStatus(withLine("- **Model (analyze):**")).stepModels).toEqual({});
  });

  test("every recorded step comes back, not just the first", () => {
    const content = [
      "# 244 - Status",
      "",
      "## Tracking info",
      "",
      "- **Model (create):** claude",
      "- **Model (analyze):** claude claude-sonnet-5",
      "- **Model (implement):** codex codex-fast",
      "- **Model (archive):** claude sonnet",
      "",
    ].join("\n");
    expect(parseStatus(content).stepModels).toEqual({
      create: "claude",
      analyze: "claude claude-sonnet-5",
      implement: "codex codex-fast",
      archive: "claude sonnet",
    });
  });

  test("progress, phase and workflowSteps are untouched by the new field", () => {
    const content = [
      "# 244 - Status",
      "",
      "## Tracking info",
      "",
      "- **Workflow steps completed:** create, analyze",
      "- **Model (analyze):** claude sonnet",
      "- **Total progress:** `95% (21 of 22 completed)`",
      "",
      "## Phase 1: RED",
      "",
      "| Task | Status | Notes |",
      "|------|--------|-------|",
      "| a    | ⬜     |       |",
      "",
    ].join("\n");
    const status = parseStatus(content);
    expect(status.progress).toEqual({ percent: 95, done: 21, total: 22 });
    expect(status.phase).toBe("Phase 1: RED");
    expect(status.workflowSteps).toEqual(["create", "analyze"]);
    expect(status.stepModels).toEqual({ analyze: "claude sonnet" });
  });
});
