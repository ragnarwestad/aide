// Spec 471: roundGate — whether a held-back spec's next Analyze/
// Implement round may start, per AC-6. No test file existed yet for
// held-back.ts in isolation (2-analysis.md, Test coverage); this is it.

import { describe, expect, test } from "bun:test";
import { latestRoundBoundary, roundGate } from "../../../src/project/parse-status";
import { fakeGit } from "../../helpers/fake-git.ts";

const acceptanceStatus = (rows: string[]) =>
  [
    "# X - Status",
    "",
    "## Acceptance criteria",
    "",
    "| Task | Status | Notes |",
    "|------|--------|-------|",
    ...rows,
    "",
    "---",
    "",
  ].join("\n");

const BOUNDARY_DESCRIPTION = [
  "- **AC-1:** first requirement",
  "- **AC-2:** second requirement, original wording",
  "",
].join("\n");

describe("latestRoundBoundary", () => {
  test("reads the sha off a Round boundary stamp", () => {
    const status = "- **Round boundary:** 2026-09-15 (history before `abc1234` does not count)\n";
    expect(latestRoundBoundary(status)).toBe("abc1234");
  });

  test("the LAST stamp wins when a spec has been held back more than once", () => {
    const status = [
      "- **Round boundary:** 2026-09-01 (history before `1111111` does not count)",
      "- **Round boundary:** 2026-09-15 (history before `2222222` does not count)",
    ].join("\n");
    expect(latestRoundBoundary(status)).toBe("2222222");
  });

  test("no stamp at all: null", () => {
    expect(latestRoundBoundary("nothing here")).toBeNull();
  });
});

describe("roundGate", () => {
  const boundaryAnswer = { "show abc1234:1-description.md": { code: 0, stdout: BOUNDARY_DESCRIPTION } };

  test("not held back on acceptance at all: notHeldBack", async () => {
    const { run } = fakeGit({});
    const status = acceptanceStatus(["| AC-1: first requirement | ✅ | |"]);
    const gate = await roundGate(run, "/repo", status, BOUNDARY_DESCRIPTION);
    expect(gate).toEqual({ notHeldBack: true });
  });

  test("held back, but never actually declined yet (no boundary stamp): notHeldBack", async () => {
    const { run } = fakeGit({});
    const status = acceptanceStatus(["| AC-1: first requirement | ⬜ | |"]);
    const gate = await roundGate(run, "/repo", status, BOUNDARY_DESCRIPTION);
    expect(gate).toEqual({ notHeldBack: true });
  });

  test("held back, every open id new since the boundary: ok", async () => {
    const { run } = fakeGit(boundaryAnswer);
    const status =
      "- **Round boundary:** 2026-09-01 (history before `abc1234` does not count)\n\n" +
      acceptanceStatus(["| AC-3: a brand new criterion | ⬜ | |"]);
    const description = BOUNDARY_DESCRIPTION + "- **AC-3:** a brand new criterion\n";
    const gate = await roundGate(run, "/repo", status, description);
    expect(gate).toEqual({ ok: true });
  });

  test("held back, every open id changed since the boundary: ok", async () => {
    const { run } = fakeGit(boundaryAnswer);
    const status =
      "- **Round boundary:** 2026-09-01 (history before `abc1234` does not count)\n\n" +
      acceptanceStatus(["| AC-1: first requirement, reworded | ⬜ | |"]);
    const description = "- **AC-1:** first requirement, reworded\n";
    const gate = await roundGate(run, "/repo", status, description);
    expect(gate).toEqual({ ok: true });
  });

  test("held back, one open id unchanged since the boundary: blockedOn names it", async () => {
    const { run } = fakeGit(boundaryAnswer);
    const status =
      "- **Round boundary:** 2026-09-01 (history before `abc1234` does not count)\n\n" +
      acceptanceStatus([
        "| AC-1: first requirement | ⬜ | |",
        "| AC-2: second requirement, reworded | ⬜ | |",
      ]);
    const description = "- **AC-1:** first requirement\n- **AC-2:** second requirement, reworded\n";
    const gate = await roundGate(run, "/repo", status, description);
    expect(gate).toEqual({ ok: false, blockedOn: "AC-1" });
  });
});
