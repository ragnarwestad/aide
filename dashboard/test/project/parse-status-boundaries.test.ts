// Split out of parse-status.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  archiveHeldBackReason,
  clearArchiveHeldBack,
  parseStatus,
  parseStatusChecks,
} from "../../src/project/parse-status.ts";

// --- spec 190: the hold-back note a met check leaves behind -------------------
//
// `archiveHeldBackReason` reads the section a declined archive run
// writes. Nothing removed it, so a spec went on reporting "held back"
// after the row it named was ticked. This is that function's removal
// counterpart, and the two share one idea of where the section ends.

describe("clearArchiveHeldBack (spec 190)", () => {
  const withSection = (reason: string) =>
    [
      "# 190 - Status",
      "",
      "**Total progress:** `95% (21 of 22 completed)`",
      "",
      "---",
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

  test("the section goes, and nothing around it does", () => {
    const out = clearArchiveHeldBack(withSection("- the Slack webhook (Phase 4, still unchecked)"))!;
    expect(out).not.toBeNull();
    expect(out).not.toContain("## Archive held back");
    expect(out).not.toContain("the Slack webhook");
    expect(out).toContain("**Total progress:** `95% (21 of 22 completed)`");
    expect(out).toContain("## Phase 4: Verify");
    expect(archiveHeldBackReason(out)).toBeNull();
  });

  test("a file with no such section is left alone — `null`, not a rewrite", () => {
    expect(clearArchiveHeldBack("# 190 - Status\n\nProse only.\n")).toBeNull();
  });

  // `archiveHeldBackReason` reads the LAST section when a spec was
  // declined twice; clearing has to take BOTH, or the reader would find
  // the earlier one and go on saying the spec is held back.
  test("two declined runs leave two sections, and both go", () => {
    const twice =
      withSection("- the Slack webhook (Phase 4, still unchecked)") +
      "\n" +
      withSection("- the manual browser check (Phase 4, still unchecked)");
    const out = clearArchiveHeldBack(twice)!;
    expect(out).not.toContain("## Archive held back");
    expect(archiveHeldBackReason(out)).toBeNull();
  });

  test("a section running to the end of the file goes with it", () => {
    const trailing = ["# 190 - Status", "", "## Archive held back", "", "- the webhook", ""].join("\n");
    expect(clearArchiveHeldBack(trailing)).toBe("# 190 - Status\n");
  });

  test("the divider that closed the section goes too — never two in a row", () => {
    const out = clearArchiveHeldBack(withSection("- the webhook"))!;
    expect(out).not.toContain("---\n\n---");
  });
});

// --- spec 198: the reopen boundary ------------------------------------------
//
// An archived spec reopened for another round carries a mark in its own
// Tracking info, beside the `**Archived:**` stamp it keeps:
//
//     - **Reopened:** 2026-08-23 (history before `1d0fe79` does not count)
//
// The mark lives in the FILES and not in the queue for the reason the
// description gives: the queue holds two hundred jobs on one machine and
// forgets older ones, while the files travel with the repository and are
// what a reader opens.
describe("spec 198: the reopen boundary", () => {
  const withMark = (line: string) =>
    ["# 198 - Status", "", "## Tracking info", "", "- **Task:** `198-slug/`", line, ""].join("\n");

  test("the canonical line yields the sha the history starts from", () => {
    const status = parseStatus(
      withMark("- **Reopened:** 2026-08-23 (history before `1d0fe79` does not count)"),
    );
    expect(status.reopenedAfter).toBe("1d0fe79");
  });

  test("a spec that has never been reopened has no boundary at all", () => {
    expect(parseStatus(withMark("- **Archived:** 2026-08-22")).reopenedAfter).toBeUndefined();
  });

  // The LAST mark wins. A spec reopened twice starts from its current
  // round, not from the first one — the same rule `archiveHeldBackReason`
  // keeps for a spec declined twice.
  test("a spec reopened twice counts from the newest mark", () => {
    const status = parseStatus(
      [
        "# 198 - Status",
        "",
        "## Tracking info",
        "",
        "- **Reopened:** 2026-08-22 (history before `aaaaaaa` does not count)",
        "- **Reopened:** 2026-08-23 (history before `bbbbbbb` does not count)",
        "",
      ].join("\n"),
    );
    expect(status.reopenedAfter).toBe("bbbbbbb");
  });

  // A mark whose sha is missing or unreadable says nothing, and "nothing"
  // is the pre-reopen behaviour — the same direction every other unknown
  // in this codebase takes. A boundary guessed at would hide a round that
  // really did run.
  test("a mark with no sha in it is not a boundary", () => {
    expect(parseStatus(withMark("- **Reopened:** 2026-08-23")).reopenedAfter).toBeUndefined();
  });
});

describe("spec 231: the work-round boundary", () => {
  test("a Reset mark is a boundary", () => {
    const status = parseStatus(
      "# Status\n\n## Tracking info\n\n- **Reset:** 2026-08-24 (history before `c0ffee1` does not count)\n",
    );
    expect(status.reopenedAfter).toBe("c0ffee1");
  });

  test("the latest valid Reset or Reopened mark wins", () => {
    const status = parseStatus(
      [
        "# Status",
        "",
        "## Tracking info",
        "",
        "- **Reset:** 2026-08-23 (history before `aaaaaaa` does not count)",
        "- **Reopened:** 2026-08-24 (history before `bbbbbbb` does not count)",
        "",
      ].join("\n"),
    );
    expect(status.reopenedAfter).toBe("bbbbbbb");
  });
});

// --- spec 246: the Total progress header is recomputed, not narrated --------
//
// The row-counting rule `core/scripts/aide-run-spec`'s new
// `total_progress_for()` reimplements in awk, checked against the same
// shared table it is: one file, read by a test on each side, the way
// WORKFLOW_STEPS and the code-landing precedence table already are.
describe("spec 246: the shared row-counting fixture (AC8, TypeScript half)", () => {
  const FIXTURE: { cases: { name: string; body: string; done: number; total: number }[] } =
    JSON.parse(
      readFileSync(join(import.meta.dir, "..", "../../tests/fixtures/status-row-counting.json"), "utf-8"),
    );

  for (const c of FIXTURE.cases) {
    test(`${c.name}: ${c.done} of ${c.total}`, () => {
      const checks = parseStatusChecks(`# X - Status\n\n${c.body}`);
      expect(checks.length).toBe(c.total);
      expect(checks.filter((check) => check.done).length).toBe(c.done);
    });
  }
});
