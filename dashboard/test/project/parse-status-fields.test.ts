// Split out of parse-status.test.ts by theme.
//
// Criteria 2-3: every observed progress-line variant parses (fixtures
// are copies of REAL status files from aide-specs and paceup); a file
// without a recognizable line yields unknown progress; the phase is
// the first phase section with unchecked tasks.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { acceptanceCriteriaUnticked, archiveHeldBackReason, parseStatus } from "../../src/project/parse-status.ts";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "..", "fixtures", "status", name), "utf-8");

describe("progress line variants (criterion 2)", () => {
  const cases: [string, { percent: number; done: number; total: number }][] = [
    ["canonical.md", { percent: 100, done: 8, total: 8 }],
    ["fremgang-prose.md", { percent: 93, done: 13, total: 14 }],
    ["fremgang-faser.md", { percent: 0, done: 0, total: 4 }],
    ["bullet-line15.md", { percent: 100, done: 9, total: 9 }],
    ["framdrift-space.md", { percent: 0, done: 0, total: 18 }],
  ];

  for (const [name, expected] of cases) {
    test(name, () => {
      expect(parseStatus(fixture(name)).progress).toEqual(expected);
    });
  }

  test("a line with no percentage yields unknown progress, no throw", () => {
    expect(parseStatus(fixture("no-percent.md")).progress).toBeNull();
  });

  test("a file with no progress line at all yields unknown, no throw", () => {
    expect(parseStatus("# Something - Status\n\nJust prose.\n").progress).toBeNull();
  });
});

describe("phase (criterion 3)", () => {
  const openPhase = [
    "# X - Status",
    "",
    "## Phase 1: RED",
    "",
    "| Task | Status | Notes |",
    "|------|--------|-------|",
    "| a    | ✅     |       |",
    "",
    "## Phase 2: GREEN",
    "",
    "| Task | Status | Notes |",
    "|------|--------|-------|",
    "| b    | ✅     |       |",
    "| c    | ⬜     |       |",
    "",
  ].join("\n");

  test("first phase section with unchecked tasks is the current phase", () => {
    expect(parseStatus(openPhase).phase).toBe("Phase 2: GREEN");
  });

  test("all tasks checked means done", () => {
    expect(parseStatus(openPhase.replace("⬜", "✅")).phase).toBe("done");
  });

  test("no phase sections means no phase", () => {
    expect(parseStatus("# X - Status\n\nProse only.\n").phase).toBeNull();
  });

  // Spec 190, criterion 2: a step wrote `Waiting` where the notation
  // table asks for `⬜`. Phase detection used to search the section's
  // raw text for the symbol, so a phase whose only open row is spelled
  // out read as settled — and with no later symbol anywhere, the whole
  // file read as `done` and the Edit page offered nothing to tick.
  test("a phase whose only open row is written in words is still the current phase", () => {
    expect(parseStatus(openPhase.replace("| c    | ⬜     |       |", "| c    | Waiting |       |")).phase).toBe(
      "Phase 2: GREEN",
    );
  });

  test("a word-written done row settles its phase exactly as ✅ does", () => {
    const words = openPhase.replace("| c    | ⬜     |       |", "| c    | Completed |       |");
    expect(parseStatus(words).phase).toBe("done");
  });

  // Spec 266: a LOW-complexity spec's `4-status.md` uses `## Checklist`
  // instead of `## Phase N: ...` — treated the same as `## Phase`/`##
  // Fase`, not as "no phase sections at all".
  const openChecklist = [
    "# X - Status",
    "",
    "## Checklist",
    "",
    "| Task | Status | Notes |",
    "|------|--------|-------|",
    "| a    | ⬜     |       |",
    "",
  ].join("\n");

  test("a ## Checklist heading with an open row is the current phase, named 'Checklist'", () => {
    expect(parseStatus(openChecklist).phase).toBe("Checklist");
  });

  test("a ## Checklist heading with every row done is 'done', same as ## Phase", () => {
    expect(parseStatus(openChecklist.replace("⬜", "✅")).phase).toBe("done");
  });

  // Spec 285: `## Acceptance criteria`, placed after the last
  // implementation phase, only becomes the current (and so tickable —
  // see overview.ts's `tickable()`) phase once every earlier phase's own
  // rows are done. No new code makes this true — it falls out of this
  // same "first phase section with an open row" rule, given the
  // ordering the section is written in.
  const phaseThenAcceptance = [
    "# X - Status",
    "",
    "## Phase 4: REFACTOR",
    "",
    "| Task | Status | Notes |",
    "|------|--------|-------|",
    "| d    | ⬜     |       |",
    "",
    "## Acceptance criteria",
    "",
    "| Task | Status | Notes |",
    "|------|--------|-------|",
    "| REQ-1: does the thing | ⬜ | |",
    "",
  ].join("\n");

  test("Acceptance criteria is not current while an earlier phase still has an open row (spec 285)", () => {
    expect(parseStatus(phaseThenAcceptance).phase).toBe("Phase 4: REFACTOR");
  });

  test("Acceptance criteria becomes current once every earlier phase is done (spec 285)", () => {
    const allEarlierDone = phaseThenAcceptance.replace("| d    | ⬜     |       |", "| d    | ✅     |       |");
    expect(parseStatus(allEarlierDone).phase).toBe("Acceptance criteria");
  });
});

// --- spec 108: an archive run that declined says so in the file --------------

// A headless archive run that finds the status unfinished does not move
// the folder — and the job's own exit status says nothing about that
// either way. The reason is written into `4-status.md`, which is the
// one place the dashboard can re-read it from.
describe("spec 108: the archive-held-back reason (criteria 9-11)", () => {
  const withSection = (reason: string) =>
    [
      "# 108 - Status",
      "",
      "**Total progress:** `95% (21 of 22 completed)`",
      "",
      "## Archive held back",
      "",
      reason,
      "",
      "---",
      "",
      "## Phase 4: Verify",
      "",
      "| Task | Status | Notes |",
      "",
    ].join("\n");

  test("the bulleted reason comes back without its bullet or the divider (criterion 9)", () => {
    const reason = archiveHeldBackReason(withSection("- the Slack webhook (Phase 4, still unchecked)"));
    expect(reason).toBe("the Slack webhook (Phase 4, still unchecked)");
  });

  test("no such section means nothing is held back (criterion 10)", () => {
    expect(archiveHeldBackReason("# 108 - Status\n\nProse only.\n")).toBeNull();
  });

  test("an empty section is no reason at all, not an empty badge", () => {
    expect(archiveHeldBackReason("# X\n\n## Archive held back\n\n## Phase 1\n")).toBeNull();
  });

  test("the LATER of two declined runs is the current reason (criterion 11)", () => {
    const twice =
      withSection("- the Slack webhook (Phase 4, still unchecked)") +
      "\n" +
      withSection("- the manual browser check (Phase 4, still unchecked)");
    expect(archiveHeldBackReason(twice)).toBe("the manual browser check (Phase 4, still unchecked)");
  });

  test("only the first line of the section is the reason", () => {
    const many = [
      "# X",
      "",
      "## Archive held back",
      "",
      "- the Slack webhook (Phase 4, still unchecked)",
      "- and a second line nobody asked for",
      "",
    ].join("\n");
    expect(archiveHeldBackReason(many)).toBe("the Slack webhook (Phase 4, still unchecked)");
  });
});

// --- spec 285's gate, said plainly instead of read as "no real progress" ---
//
// `aide-run-spec`'s mechanical precheck already refuses cleanly on an
// unticked Acceptance criteria row (no AI spent), but that reason never
// reached this page: a fresh archive attempt refusing again showed a
// "ready" row with nothing saying why a retry would refuse the same
// way. `acceptanceCriteriaUnticked` is the read `spec-lookup.ts` feeds
// into the same `archiveHeldBack` field `restingChip()` already reads,
// so the row explains itself without a second field to thread through.
describe("acceptance criteria left unticked (spec 291's fix, applied 2026-08-31)", () => {
  const withAcceptance = (rows: string) =>
    [
      "# X - Status",
      "",
      "## Acceptance criteria",
      "",
      "| Task | Status | Notes |",
      "|------|--------|-------|",
      rows,
      "",
      "---",
      "",
    ].join("\n");

  test("any unticked row under Acceptance criteria is true", () => {
    expect(acceptanceCriteriaUnticked(withAcceptance("| REQ-1: … | ⬜ | |"))).toBe(true);
  });

  test("every row ticked is false", () => {
    expect(acceptanceCriteriaUnticked(withAcceptance("| REQ-1: … | ✅ | |"))).toBe(false);
  });

  test("no Acceptance criteria section at all is false, not a crash", () => {
    expect(acceptanceCriteriaUnticked("# X - Status\n\n## Phase 1\n\n| Task | Status | Notes |\n")).toBe(false);
  });

  test("one ticked, one not, is still true — the row that matters is the open one", () => {
    const rows = "| REQ-1: … | ✅ | |\n| REQ-2: … | ⬜ | |";
    expect(acceptanceCriteriaUnticked(withAcceptance(rows))).toBe(true);
  });
});

// --- spec 139: the one record of how far a spec has got ---------------------

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
