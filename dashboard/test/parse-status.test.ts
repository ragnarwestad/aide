// Criteria 2-3: every observed progress-line variant parses (fixtures
// are copies of REAL status files from aide-specs and paceup); a file
// without a recognizable line yields unknown progress; the phase is
// the first phase section with unchecked tasks.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { archiveHeldBackReason, parseStatus } from "../src/parse-status.ts";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "fixtures", "status", name), "utf-8");

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
