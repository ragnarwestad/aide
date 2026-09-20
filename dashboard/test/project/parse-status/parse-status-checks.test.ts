import { describe, expect, test } from "bun:test";
import {
  acceptanceSectionUnreadable,
  checkStateOf,
  failedCount,
  markFailedStatusLine,
  markNotVerifiedStatusLine,
  notVerifiedCount,
  parseStatusChecks,
  tickStatusLine,
  untickStatusLine,
  withoutAcceptanceSections,
} from "../../../src/project/parse-status";

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
      { phase: "Phase 1: RED", line: "| a task | Waiting | |", task: "a task", done: false, note: "" },
    ]);
  });

  // `Completed` is not an invented synonym: it is the word the file's
  // own Notation table already gives for ✅.
  test("`Completed`, written out, is done", () => {
    const checks = parseStatusChecks(phase("Phase 1: RED", ["| a task | Completed | |"]));
    expect(checks).toHaveLength(1);
    expect(checks[0]!.done).toBe(true);
  });

  // Spec 283: a step wrote the symbol AND the word into the same cell.
  // Neither form alone, the combination — and it must still count as done.
  test("`✅ Completed`, symbol and word combined, is done", () => {
    const checks = parseStatusChecks(phase("Phase 1: RED", ["| a task | ✅ Completed | |"]));
    expect(checks).toHaveLength(1);
    expect(checks[0]!.done).toBe(true);
  });

  // The word "completed" appearing as part of unrelated free text must
  // not be mistaken for the combined mark above — only the anchored,
  // whole-cell pattern counts as done.
  test("unrelated text containing the word \"completed\" stays open", () => {
    const checks = parseStatusChecks(phase("Phase 1: RED", ["| a task | not completed | |"]));
    expect(checks).toHaveLength(1);
    expect(checks[0]!.done).toBe(false);
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
    expect(checks).toEqual([{ phase: "Checklist", line: "| a task | ⬜ | |", task: "a task", done: false, note: "" }]);
  });

  // Spec 285: `## Acceptance criteria` sections count the same as `##
  // Phase`/`## Fase`/`## Checklist` — the dedicated, person-only rows
  // spec 268's own description deferred.
  test("## Acceptance criteria sections count the same as ## Phase (spec 285)", () => {
    const acceptance = [
      "## Acceptance criteria",
      "",
      "| Task | Status | Notes |",
      "|------|--------|-------|",
      "| REQ-1: does the thing | ⬜ | |",
      "",
    ].join("\n");
    const checks = parseStatusChecks(acceptance);
    expect(checks).toEqual([
      { phase: "Acceptance criteria", line: "| REQ-1: does the thing | ⬜ | |", task: "REQ-1: does the thing", done: false, note: "" },
    ]);
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

  // Spec 285: an Acceptance-criteria row ticks through the same route as
  // any other phase's row — no new code in tickStatusLine itself, only
  // PHASE_HEADING_RE recognizing the heading.
  test("tickStatusLine ticks a row under ## Acceptance criteria exactly like any other phase (spec 285)", () => {
    const file = [
      "# X - Status",
      "",
      "## Acceptance criteria",
      "",
      "| Task | Status | Notes |",
      "|------|--------|-------|",
      "| REQ-1: does the thing | ⬜ | |",
      "",
    ].join("\n");
    const out = tickStatusLine(file, "Acceptance criteria", "| REQ-1: does the thing | ⬜ | |")!;
    expect(out).not.toBeNull();
    expect(out.split("\n")[6]).toBe("| REQ-1: does the thing | ✅ | |");
  });
});

// The Notes cell is the one thing on an acceptance row a reader cannot
// work out from the criterion itself: what the run delivered against it,
// and any limit on that. Spec 340's own file carries the shape —
// "Delivered for the no-retry case only" beside a ticked REQ — and it
// was parsed and thrown away, so the Checks tab could never show it.
describe("the Notes cell (spec 340's caveat, and every other row's)", () => {
  const acceptance = (rows: string[]): string =>
    ["## Acceptance criteria", "", "| Task | Status | Notes |", "|------|--------|-------|", ...rows, ""].join("\n");

  test("a row's note is carried, verbatim", () => {
    const line = "| REQ-3: the figure follows the same rule | ✅ | Delivered for the no-retry case only |";
    const checks = parseStatusChecks(acceptance([line]));
    expect(checks).toEqual([
      {
        phase: "Acceptance criteria",
        line,
        task: "REQ-3: the figure follows the same rule",
        done: true,
        note: "Delivered for the no-retry case only",
      },
    ]);
  });

  test("an empty Notes cell is an empty note, not a missing one", () => {
    const checks = parseStatusChecks(acceptance(["| REQ-1: does the thing | ⬜ | |"]));
    expect(checks[0]!.note).toBe("");
  });

  test("a note on a Phase row is carried too — the same table shape reads the same way", () => {
    const line = "| Write the test | ✅ | One commit, both files included |";
    const checks = parseStatusChecks(["## Phase 1: RED", "", "| Task | Status | Notes |", "|---|---|---|", line, ""].join("\n"));
    expect(checks[0]!.note).toBe("One commit, both files included");
  });
});

// Spec 404 landed with `| REQ | Criterion | Accepted |` instead of the
// `| Task | Status | Notes |` the rule gives. That puts the criterion
// where the MARK belongs, so every row is rejected — the Checks tab drew
// an empty list and the archive gate read "nothing open" from a spec
// nobody had judged. The difference has to be answerable.
describe("acceptanceSectionUnreadable", () => {
  const section = (header: string, rows: string[]): string =>
    ["# X - Status", "", "## Acceptance criteria", "", header, "|---|---|---|", ...rows, ""].join("\n");

  test("the rule's own table reads, so it is not unreadable", () => {
    const text = section("| Task | Status | Notes |", ["| REQ-1: does the thing | ⬜ | |"]);
    expect(parseStatusChecks(text)).toHaveLength(1);
    expect(acceptanceSectionUnreadable(text)).toBe(false);
  });

  test("spec 404's own shape reads as nothing, and says so", () => {
    const text = section("| REQ | Criterion | Accepted |", [
      "| REQ-1 | The specs a spec depends on are shown above the scrolling list | ☐ |",
    ]);
    expect(parseStatusChecks(text)).toHaveLength(0);
    expect(acceptanceSectionUnreadable(text)).toBe(true);
  });

  test("a file with no Acceptance section at all is not unreadable — it simply has none", () => {
    expect(acceptanceSectionUnreadable("# X - Status\n\n## Phase 1: RED\n")).toBe(false);
  });

  test("an Acceptance section with a sentence instead of a table reads as nothing", () => {
    const text = "# X - Status\n\n## Acceptance criteria\n\nAcceptance ticking was not required for this run.\n";
    expect(acceptanceSectionUnreadable(text)).toBe(true);
  });
});

describe("withoutAcceptanceSections (AC-1, AC-3)", () => {
  const acc = ["## Acceptance criteria", "", "| Task | Status | Notes |", "|---|---|---|", "| AC-1: a | ⬜ | |", ""];

  test("cuts the section in the middle and keeps every other line in order (AC-3)", () => {
    const text = ["# X - Status", "", "## Phase 1: RED", "", "| a | ⬜ | |", "", ...acc, "## Notation", "", "- x", ""].join("\n");
    expect(withoutAcceptanceSections(text)).toBe(
      ["# X - Status", "", "## Phase 1: RED", "", "| a | ⬜ | |", "", "## Notation", "", "- x", ""].join("\n"),
    );
  });

  test("cuts a section that is last in the file (AC-1)", () => {
    const text = ["# X - Status", "", "## Phase 1: RED", "", ...acc].join("\n");
    const out = withoutAcceptanceSections(text);
    expect(out).not.toContain("Acceptance");
    expect(out).not.toContain("AC-1");
    expect(out).toContain("## Phase 1: RED");
  });

  test("cuts two sections (AC-1)", () => {
    const text = [...acc, "## Notation", "", ...acc].join("\n");
    expect(withoutAcceptanceSections(text)).toBe(["## Notation", ""].join("\n"));
  });

  test("a file with no Acceptance section is returned unchanged (AC-3)", () => {
    const text = "# X - Status\n\n## Phase 1: RED\n\n| a | ⬜ | |\n";
    expect(withoutAcceptanceSections(text)).toBe(text);
  });

  test("a heading with nothing under it is cut to the next heading (AC-1)", () => {
    const text = "# X\n\n## Acceptance criteria\n## Notation\n- x\n";
    expect(withoutAcceptanceSections(text)).toBe("# X\n\n## Notation\n- x\n");
  });
});

// --- spec 509: a third mark, `Not verified` ---------------------------------

describe("the Not verified mark (spec 509)", () => {
  const ROW = (mark: string) => `| AC-1: it deploys | ${mark} | a note |`;
  const file = (mark: string) =>
    ["# X - Status", "", "## Acceptance criteria", "", "| Task | Status | Notes |", "|---|---|---|", ROW(mark), ""].join("\n");
  const PHASE = "Acceptance criteria";

  test("a Not verified row reads as done and flagged, in any case (AC-1)", () => {
    for (const mark of ["Not verified", "not verified", "NOT VERIFIED"]) {
      const [row] = parseStatusChecks(file(mark));
      expect(row!.done).toBe(true);
      expect(row!.notVerified).toBe(true);
    }
  });

  test("a done or open row carries no flag at all (AC-1)", () => {
    for (const mark of ["✅", "⬜"]) expect("notVerified" in parseStatusChecks(file(mark))[0]!).toBe(false);
  });

  test("notVerifiedCount counts flagged rows and nothing else (AC-3)", () => {
    expect(notVerifiedCount([{ notVerified: true }, {}, { notVerified: false }, { notVerified: true }])).toBe(2);
    expect(notVerifiedCount([])).toBe(0);
  });

  // The mover, for every ordered pair of states.
  const MARK = { open: "⬜", notVerified: "Not verified", done: "✅" } as const;
  type S = keyof typeof MARK;
  const states: S[] = ["open", "notVerified", "done"];
  const move = (from: S, to: S): string | null => {
    const text = file(MARK[from]);
    const line = ROW(MARK[from]);
    if (to === "done") return tickStatusLine(text, PHASE, line);
    if (to === "open") return untickStatusLine(text, PHASE, line);
    return markNotVerifiedStatusLine(text, PHASE, line);
  };

  for (const from of states) {
    for (const to of states) {
      test(`${from} -> ${to} (AC-1)`, () => {
        const out = move(from, to);
        if (from === to) return expect(out).toBeNull();
        expect(out).toBe(file(MARK[from]).replace(ROW(MARK[from]), ROW(MARK[to])));
      });
    }
  }

  test("only the moved row's cell changes; its neighbour keeps its padding (AC-1)", () => {
    const text = ["## Acceptance criteria", "", "| Task | Status | Notes |", "|---|---|---|", "| a | ⬜ | |", "| b  | ⬜   | |"].join("\n");
    const out = markNotVerifiedStatusLine(text, "Acceptance criteria", "| a | ⬜ | |")!;
    expect(out.split("\n").slice(-2)).toEqual(["| a | Not verified | |", "| b  | ⬜   | |"]);
  });
});

// --- spec 510: a fourth mark, `Failed` ---------------------------------------

describe("the Failed mark (spec 510)", () => {
  const file = (mark: string, note = "a note") =>
    ["# X - Status", "", "## Acceptance criteria", "", "| Task | Status | Notes |", "|---|---|---|", `| AC-1: it deploys | ${mark} | ${note} |`, ""].join("\n");
  const PHASE = "Acceptance criteria";

  test("a Failed row reads as open and flagged, with or without its symbol (AC-4)", () => {
    for (const mark of ["❌ Failed", "Failed", "failed", "FAILED"]) {
      const [row] = parseStatusChecks(file(mark));
      expect(row!.done).toBe(false);
      expect(row!.failed).toBe(true);
      expect(checkStateOf(row!)).toBe("failed");
    }
  });

  test("a bare ❌ stays Blocked: open and not flagged (AC-4)", () => {
    const [row] = parseStatusChecks(file("❌"));
    expect(row!.done).toBe(false);
    expect("failed" in row!).toBe(false);
  });

  test("a Failed row in a Phase table carries no flag (AC-4)", () => {
    const text = ["## Phase 1: RED", "", "| Task | Status | Notes |", "|---|---|---|", "| a | ❌ Failed | |", ""].join("\n");
    const [row] = parseStatusChecks(text);
    expect(row!.done).toBe(false);
    expect("failed" in row!).toBe(false);
  });

  test("failedCount counts flagged rows and nothing else (AC-5)", () => {
    expect(failedCount([{ failed: true }, {}, { failed: false }, { failed: true }])).toBe(2);
  });

  test("markFailedStatusLine writes the mark and a Failed: note, the rest of the file untouched (AC-4)", () => {
    const from = file("Not verified", "Not tested: needs the deploy");
    const line = "| AC-1: it deploys | Not verified | Not tested: needs the deploy |";
    const out = markFailedStatusLine(from, PHASE, line, "the log shows no row");
    expect(out).toBe(from.replace(line, "| AC-1: it deploys | ❌ Failed | Failed: the log shows no row |"));
  });

  test("the note is cleaned: pipes, newlines, $& and an empty Notes cell (AC-4)", () => {
    const line = "| AC-1: it deploys | Not verified | |";
    const from = file("Not verified", "").replace("|  |", "| |");
    const out = markFailedStatusLine(from, PHASE, line, "  a | b\nc $& d 🙂 ")!;
    expect(out).toContain("| AC-1: it deploys | ❌ Failed | Failed: a / b c $& d 🙂 |");
  });

  test("an empty note is refused, and so is a row that is not there or already Failed (AC-4)", () => {
    const line = "| AC-1: it deploys | Not verified | a note |";
    expect(markFailedStatusLine(file("Not verified"), PHASE, line, "  ")).toBeNull();
    expect(markFailedStatusLine(file("Not verified"), PHASE, "| nope | Not verified | |", "x")).toBeNull();
    const failed = "| AC-1: it deploys | ❌ Failed | a note |";
    expect(markFailedStatusLine(file("❌ Failed"), PHASE, failed, "x")).toBeNull();
  });

  test("a Failed row is never moved by the tick, untick or Not verified movers (AC-4)", () => {
    const line = "| AC-1: it deploys | ❌ Failed | a note |";
    expect(untickStatusLine(file("❌ Failed"), PHASE, line)).toBeNull();
    expect(tickStatusLine(file("❌ Failed"), PHASE, line)).toBeNull();
    expect(markNotVerifiedStatusLine(file("❌ Failed"), PHASE, line)).toBeNull();
  });
});
