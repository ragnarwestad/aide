// Split out of parse-status.test.ts by theme.
//
// Criteria 2-3: every observed progress-line variant parses (fixtures
// are copies of REAL status files from aide-specs and paceup); a file
// without a recognizable line yields unknown progress; the phase is
// the first phase section with unchecked tasks.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCEPTANCE_CRITERIA_UNTICKED_NOTE,
  acceptanceCriteriaUnticked,
  acceptanceStillOpen,
  archiveHeldBackApplies,
  archiveHeldBackReason,
  parseStatus,
} from "../../src/project/parse-status.ts";

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

  // Spec 299's follow-up: unlike `phase`, `acceptancePhase` reads as
  // open EVEN WHILE an earlier phase still has one too — those rows are
  // the spec's own person to judge, never behind implement's own
  // checklist.
  test("acceptancePhase is set even while an earlier phase is still current (spec 299)", () => {
    const info = parseStatus(phaseThenAcceptance);
    expect(info.phase).toBe("Phase 4: REFACTOR");
    expect(info.acceptancePhase).toBe("Acceptance criteria");
  });

  test("acceptancePhase is null once every Acceptance row is ticked", () => {
    const allTicked = phaseThenAcceptance.replace("| REQ-1: does the thing | ⬜ | |", "| REQ-1: does the thing | ✅ | |");
    expect(parseStatus(allTicked).acceptancePhase).toBeNull();
  });

  test("acceptancePhase is null when the file has no Acceptance criteria section", () => {
    expect(parseStatus("# Status\n\n## Phase 1: RED\n\n| Task | Status | Notes |\n|---|---|---|\n| a | ⬜ | |\n").acceptancePhase).toBeNull();
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

// The validity rule for a held-back reason lives HERE, next to the
// constant it compares against, so the layer rendering it (`heldBackFor`
// in queue-list/data-model/phases.ts) asks instead of re-deriving the
// comparison itself — re-deriving it is how spec 299's follow-up and
// spec 298's fix collided in the first place.
describe("archiveHeldBackApplies", () => {
  test("the acceptance-criteria note means nothing while implement is not done", () => {
    expect(archiveHeldBackApplies(ACCEPTANCE_CRITERIA_UNTICKED_NOTE, ["analyze"])).toBe(false);
  });

  test("the acceptance-criteria note applies once implement is done", () => {
    expect(archiveHeldBackApplies(ACCEPTANCE_CRITERIA_UNTICKED_NOTE, ["analyze", "implement"])).toBe(true);
  });

  test("every other reason applies regardless — it came out of an actual declined run", () => {
    expect(archiveHeldBackApplies("the Slack webhook (Phase 4, still unchecked)", [])).toBe(true);
  });
});

// A tick only ever ADDS ticks, so neither copy of the file is allowed
// to outvote the other's "all ticked": reading the branch alone said
// held back over a spec ticked on disk (337), and reading disk alone
// said it over a spec ticked on its branch (364).
describe("acceptanceStillOpen", () => {
  const open = [{ done: false }];
  const ticked = [{ done: true }];

  test("both copies still open", () => {
    expect(acceptanceStillOpen(true, open)).toBe(true);
  });

  test("ticked on the branch, still open on disk", () => {
    expect(acceptanceStillOpen(false, open)).toBe(false);
  });

  test("ticked on disk, still open on the branch's cached answer", () => {
    expect(acceptanceStillOpen(true, ticked)).toBe(false);
  });

  test("no branch answer: disk decides", () => {
    expect(acceptanceStillOpen(undefined, open)).toBe(true);
    expect(acceptanceStillOpen(undefined, ticked)).toBe(false);
  });

  // A copy with no rows knows nothing — a spec whose acceptance rows
  // exist only on an unlanded analyze's branch must not have the disk's
  // silence read as agreement.
  test("a copy with no rows at all answers nothing", () => {
    expect(acceptanceStillOpen(true, [])).toBe(true);
    expect(acceptanceStillOpen(true, undefined)).toBe(true);
    expect(acceptanceStillOpen(undefined, [])).toBe(false);
  });
});

// --- spec 139: the one record of how far a spec has got ---------------------
