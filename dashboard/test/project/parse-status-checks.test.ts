import { describe, expect, test } from "bun:test";
import { parseStatusChecks, tickStatusLine } from "../../src/project/parse-status.ts";

// --- spec 182: the rows a person can tick off from the page -----------------
//
// `4-status.md`'s Phase sections each carry one `| Task | Status |
// Notes |` table, and the Status cell is the one character that says
// whether the row is done. The description called them "checkboxes";
// no spec has ever contained a `- [ ]` line, and this table row is what
// the template has written since it was written.

describe("parseStatusChecks (spec 182)", () => {
  const phase = (heading: string, rows: string[]): string =>
    [`## ${heading}`, "", "### Tasks", "", "| Task | Status | Notes |", "|------|--------|-------|", ...rows, ""].join(
      "\n",
    );

  // Modelled on spec 179's own file: two phases, real prose in Notes,
  // one row still open at the bottom.
  const REAL = [
    "# An AI and a model on every phase line - Status",
    "",
    "## Tracking info",
    "",
    "- **Workflow steps completed:** create, analyze, implement",
    "",
    "---",
    "",
    phase("Phase 3: GREEN - Verify tests", [
      "| Run the four touched test files | ✅ | plus `design-system.test.ts` |",
      "| `bunx tsc --noEmit` | ✅ | |",
    ]),
    "---",
    "",
    phase("Phase 4: REFACTOR - Test suite", [
      "| `cd dashboard && make test` (full gate) | ✅ | 1742 pass, 0 fail |",
      "| Manual check at 375px in a real browser | ⬜ | **still outstanding** — see below |",
    ]),
    "---",
    "",
    "## Notation",
    "",
    "| Symbol | Meaning |",
    "|--------|---------|",
    "| ⬜ | Not started |",
    "| ✅ | Completed |",
    "",
  ].join("\n");

  test("reads every phase's rows, done and not, in file order", () => {
    const checks = parseStatusChecks(REAL);
    expect(checks.map((c) => c.task)).toEqual([
      "Run the four touched test files",
      "`bunx tsc --noEmit`",
      "`cd dashboard && make test` (full gate)",
      "Manual check at 375px in a real browser",
    ]);
    expect(checks.map((c) => c.done)).toEqual([true, true, true, false]);
    expect(checks[0]!.phase).toBe("Phase 3: GREEN - Verify tests");
    expect(checks[3]!.phase).toBe("Phase 4: REFACTOR - Test suite");
  });

  test("each row carries its own line back, verbatim — that is the guard the tick posts", () => {
    const open = parseStatusChecks(REAL).find((c) => !c.done)!;
    expect(open.line).toBe("| Manual check at 375px in a real browser | ⬜ | **still outstanding** — see below |");
    expect(REAL.split("\n")).toContain(open.line);
  });

  test("the Notation legend is not a phase, so its rows are not checks", () => {
    expect(parseStatusChecks(REAL).some((c) => c.task === "Symbol" || c.task === "⬜")).toBe(false);
  });

  test("the table's own header and separator rows are not checks", () => {
    expect(parseStatusChecks(REAL).some((c) => c.task === "Task" || c.task.startsWith("---"))).toBe(false);
  });

  test("a not-yet-implemented spec's placeholder rows still parse — they are what a fresh spec has", () => {
    const fresh = phase("Phase 1: RED - Write tests", [
      "| Create test file | ⬜ | |",
      "| Write test for [functionality 1] | ⬜ | |",
    ]);
    const checks = parseStatusChecks(fresh);
    expect(checks).toHaveLength(2);
    expect(checks.every((c) => !c.done)).toBe(true);
  });

  test("a malformed row is skipped rather than guessed at", () => {
    const bad = phase("Phase 1: RED", [
      "| two columns only | ⬜ |",
      "| a | b | c | d |",
      "| a mark that is prose | in progress, mostly | |",
      "| a good one | ⬜ | |",
    ]);
    expect(parseStatusChecks(bad).map((c) => c.task)).toEqual(["a good one"]);
  });

  // Spec 190: the Status cell is free text, and a step wrote words into
  // it. The old shape guard rejected anything over four characters, so
  // the row was not merely read as open — it never reached this list.
  test("an open row written in words is a check, exactly as a symbol one is", () => {
    const checks = parseStatusChecks(phase("Phase 1: RED", ["| a task | Waiting | |"]));
    expect(checks).toEqual([
      { phase: "Phase 1: RED", line: "| a task | Waiting | |", task: "a task", done: false },
    ]);
  });

  // `Completed` is not an invented synonym: it is the word the file's
  // own Notation table already gives for ✅.
  test("`Completed`, written out, is done", () => {
    const checks = parseStatusChecks(phase("Phase 1: RED", ["| a task | Completed | |"]));
    expect(checks).toHaveLength(1);
    expect(checks[0]!.done).toBe(true);
  });

  test("the notation table's other spellings are read as open, not dropped", () => {
    const checks = parseStatusChecks(
      phase("Phase 1: RED", [
        "| a | Not started | |",
        "| b | In progress | |",
        "| c | Awaiting clarification | |",
      ]),
    );
    expect(checks.map((c) => c.task)).toEqual(["a", "b", "c"]);
    expect(checks.every((c) => !c.done)).toBe(true);
  });

  test("a file with no Phase or Fase heading has no checks at all", () => {
    expect(parseStatusChecks("# X - Status\n\n## Summary\n\n| a | ⬜ | |\n")).toEqual([]);
  });

  test("Norwegian `## Fase` sections count the same as `## Phase`", () => {
    expect(parseStatusChecks(phase("Fase 1: RED", ["| Skriv testen | ⬜ | |"]))).toHaveLength(1);
  });

  // Spec 266: `## Checklist` sections count the same as `## Phase`/`##
  // Fase` — a LOW-complexity spec's status file uses this heading
  // instead, and its rows must be offered as checks too.
  test("## Checklist sections count the same as ## Phase (spec 266)", () => {
    const checklist = [
      "## Checklist",
      "",
      "| Task | Status | Notes |",
      "|------|--------|-------|",
      "| a task | ⬜ | |",
      "",
    ].join("\n");
    const checks = parseStatusChecks(checklist);
    expect(checks).toEqual([{ phase: "Checklist", line: "| a task | ⬜ | |", task: "a task", done: false }]);
  });
});

describe("tickStatusLine (spec 182)", () => {
  const FILE = [
    "# X - Status",
    "",
    "## Phase 1: RED",
    "",
    "| Task | Status | Notes |",
    "|------|--------|-------|",
    "| Run the tests | ⬜ | |",
    "| Look at it | ✅ | |",
    "",
    "## Phase 4: REFACTOR",
    "",
    "| Task | Status | Notes |",
    "|------|--------|-------|",
    "| Run the tests | ⬜ | |",
    "",
  ].join("\n");
  const ROW = "| Run the tests | ⬜ | |";

  test("flips exactly the matched line's mark and nothing else", () => {
    const out = tickStatusLine(FILE, "Phase 1: RED", ROW)!;
    expect(out).not.toBeNull();
    const before = FILE.split("\n");
    const after = out.split("\n");
    expect(after).toHaveLength(before.length);
    const changed = after.map((l, i) => [i, l] as const).filter(([i, l]) => l !== before[i]);
    expect(changed).toEqual([[6, "| Run the tests | ✅ | |"]]);
  });

  test("the same row text in another phase is a different row", () => {
    const out = tickStatusLine(FILE, "Phase 4: REFACTOR", ROW)!;
    expect(out.split("\n")[6]).toBe(ROW);
    expect(out.split("\n")[13]).toBe("| Run the tests | ✅ | |");
  });

  test("a row already ✅ is refused", () => {
    expect(tickStatusLine(FILE, "Phase 1: RED", "| Look at it | ✅ | |")).toBeNull();
  });

  test("a line not present verbatim is refused — this is the row-level guard", () => {
    expect(tickStatusLine(FILE, "Phase 1: RED", "| Run the tests |⬜| |")).toBeNull();
    expect(tickStatusLine(FILE, "Phase 1: RED", "| Run the other tests | ⬜ | |")).toBeNull();
  });

  test("a phase heading the file does not have is refused", () => {
    expect(tickStatusLine(FILE, "Phase 9: NOTHING", ROW)).toBeNull();
  });

  test("a line outside the named phase's own section is refused", () => {
    expect(tickStatusLine(FILE, "Phase 1: RED", "| Task | Status | Notes |")).toBeNull();
  });

  test("the cell's padding survives — one character changes, not the table's shape", () => {
    const padded = "## Phase 1: RED\n\n| Task | Status | Notes |\n|---|---|---|\n| A |   ⬜   | note |\n";
    expect(tickStatusLine(padded, "Phase 1: RED", "| A |   ⬜   | note |")).toContain("| A |   ✅   | note |");
  });

  // --- spec 190: a row a step spelled out in words --------------------------

  const WORDS = [
    "# X - Status",
    "",
    "## Phase 1: RED",
    "",
    "| Task | Status | Notes |",
    "|------|--------|-------|",
    "| Run the tests | Waiting | |",
    "| Look at it | Completed | |",
    "",
  ].join("\n");

  // Ticking normalises the file's own spelling on the way past: the
  // page writes the mark the Notation table promises, never the word it
  // found.
  test("ticking a word-written row writes the canonical ✅", () => {
    const out = tickStatusLine(WORDS, "Phase 1: RED", "| Run the tests | Waiting | |")!;
    expect(out).not.toBeNull();
    expect(out.split("\n")[6]).toBe("| Run the tests | ✅ | |");
  });

  test("a row already done in words is refused a second tick", () => {
    expect(tickStatusLine(WORDS, "Phase 1: RED", "| Look at it | Completed | |")).toBeNull();
  });
});
