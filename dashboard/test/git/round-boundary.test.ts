// Spec 471, AC-6: the per-AC-n-row git diff a held-back round's gate
// reads — one line at a time, against the repo's own FakeGitRunner
// convention (dashboard/CLAUDE.md's plan review note), never a real git
// process.

import { describe, expect, test } from "bun:test";
import { acRowsAt, acRowsFromText, criteriaMovedOn } from "../../src/git/round-boundary.ts";
import { fakeGit } from "../helpers/fake-git.ts";

const BOUNDARY_DESCRIPTION = [
  "# X - Description",
  "",
  "## Acceptance criteria",
  "",
  "- **AC-1:** first requirement",
  "- **AC-2:** second requirement, original wording",
  "",
].join("\n");

describe("acRowsAt", () => {
  test("reads every AC-n line at the given sha, keyed by id", async () => {
    const { run } = fakeGit({ "show deadbee:1-description.md": { code: 0, stdout: BOUNDARY_DESCRIPTION } });
    const rows = await acRowsAt(run, "/repo", "deadbee");
    expect(rows.get("AC-1")).toBe("first requirement");
    expect(rows.get("AC-2")).toBe("second requirement, original wording");
    expect(rows.has("AC-3")).toBe(false);
  });

  test("an unreadable revision answers with no rows at all", async () => {
    const { run } = fakeGit({});
    const rows = await acRowsAt(run, "/repo", "nosuchsha");
    expect(rows.size).toBe(0);
  });
});

describe("acRowsFromText", () => {
  test("reads the same shape off plain text, no git involved", () => {
    const rows = acRowsFromText(BOUNDARY_DESCRIPTION);
    expect(rows.get("AC-1")).toBe("first requirement");
  });
});

describe("criteriaMovedOn", () => {
  const boundaryRows = acRowsFromText(BOUNDARY_DESCRIPTION);

  test("every open id changed since the boundary: moved on", () => {
    const current = acRowsFromText(
      "- **AC-1:** first requirement, reworded\n- **AC-2:** second requirement, reworded\n",
    );
    expect(criteriaMovedOn(current, ["AC-1", "AC-2"], boundaryRows)).toBe(true);
  });

  test("an open id absent from the boundary is new: silence reads as new, never as unchanged", () => {
    const current = acRowsFromText("- **AC-3:** a brand new criterion\n");
    expect(criteriaMovedOn(current, ["AC-3"], boundaryRows)).toBe(true);
  });

  // One open criterion reworded is enough: the others may be fine as they
  // stand, and a rule that made every open one change forced edits with
  // no reason behind them (PaceUp 04, 2026-09-18).
  test("one open id changed and another unchanged: moved on", () => {
    const current = acRowsFromText(
      "- **AC-1:** first requirement\n- **AC-2:** second requirement, reworded\n",
    );
    expect(criteriaMovedOn(current, ["AC-1", "AC-2"], boundaryRows)).toBe(true);
  });

  test("a criterion added to the description, with no status row yet, is new: moved on", () => {
    const current = acRowsFromText(
      "- **AC-1:** first requirement\n- **AC-2:** second requirement, original wording\n- **AC-3:** added\n",
    );
    expect(criteriaMovedOn(current, ["AC-1", "AC-2"], boundaryRows)).toBe(true);
  });

  test("every open id byte-identical to its boundary text, nothing added: not moved on", () => {
    const current = acRowsFromText(
      "- **AC-1:** first requirement\n- **AC-2:** second requirement, original wording\n",
    );
    expect(criteriaMovedOn(current, ["AC-2", "AC-1"], boundaryRows)).toBe(false);
  });

  test("a ticked (closed) id is never checked, whatever its text", () => {
    const current = acRowsFromText("- **AC-1:** first requirement, reworded\n- **AC-2:** second requirement, original wording\n");
    expect(criteriaMovedOn(current, ["AC-2"], boundaryRows)).toBe(false);
  });
});
