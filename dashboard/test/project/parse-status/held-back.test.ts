// Spec 471: roundGate — whether a held-back spec's next Analyze/
// Implement round may start, per AC-6. No test file existed yet for
// held-back.ts in isolation (2-analysis.md, Test coverage); this is it.

import { describe, expect, test } from "bun:test";
import { latestRoundBoundary, reopenedRound, roundGate } from "../../../src/project/parse-status";
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
  const boundaryAnswer = { "show abc1234:./1-description.md": { code: 0, stdout: BOUNDARY_DESCRIPTION } };

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

  test("held back, one open id unchanged and another changed: ok — one is enough", async () => {
    const { run } = fakeGit(boundaryAnswer);
    const status =
      "- **Round boundary:** 2026-09-01 (history before `abc1234` does not count)\n\n" +
      acceptanceStatus([
        "| AC-1: first requirement | ⬜ | |",
        "| AC-2: second requirement, reworded | ⬜ | |",
      ]);
    const description = "- **AC-1:** first requirement\n- **AC-2:** second requirement, reworded\n";
    const gate = await roundGate(run, "/repo", status, description);
    expect(gate).toEqual({ ok: true });
  });

  test("held back, no open id changed and nothing added: refused", async () => {
    const { run } = fakeGit(boundaryAnswer);
    const status =
      "- **Round boundary:** 2026-09-01 (history before `abc1234` does not count)\n\n" +
      acceptanceStatus([
        "| AC-1: first requirement | ⬜ | |",
        "| AC-2: second requirement, original wording | ⬜ | |",
      ]);
    const gate = await roundGate(run, "/repo", status, BOUNDARY_DESCRIPTION);
    expect(gate).toEqual({ ok: false });
  });
});

const STAMP = "- **Round boundary:** 2026-09-19 (history before `abc1234` does not count)";
const ARCHIVED = "- **Archived:** 2026-09-10";

describe("reopenedRound", () => {
  test("an Archived stamp followed by a Round boundary stamp is a reopened round AC-5", () => {
    expect(reopenedRound(`${ARCHIVED}\n${STAMP}\n`)).toBe(true);
  });
  test("a Closed stamp followed by a Round boundary stamp is a reopened round AC-5", () => {
    expect(reopenedRound(`- **Closed:** 2026-09-10\n${STAMP}\n`)).toBe(true);
  });
  test("a boundary with no Archived or Closed stamp before it is not (a held-back spec) AC-5", () => {
    expect(reopenedRound(`${STAMP}\n`)).toBe(false);
  });
  test("a Reopened or Reset mark in between makes it not a keep-reopen AC-5", () => {
    expect(reopenedRound(`${ARCHIVED}\n- **Reopened:** 2026-09-12\n${STAMP}\n`)).toBe(false);
    expect(reopenedRound(`${ARCHIVED}\n- **Reset:** 2026-09-12\n${STAMP}\n`)).toBe(false);
  });
  test("archived again after the boundary is history, not an open round AC-5", () => {
    expect(reopenedRound(`${ARCHIVED}\n${STAMP}\n- **Archived:** 2026-09-20\n`)).toBe(false);
  });
});

describe("roundGate for a reopened spec", () => {
  const boundaryAnswer = { "show abc1234:./1-description.md": { code: 0, stdout: BOUNDARY_DESCRIPTION } };
  const reopenedStatus = (rows: string[]) => `${ARCHIVED}\n${STAMP}\n\n` + acceptanceStatus(rows);
  const ticked = ["| AC-1: first requirement | ✅ | |", "| AC-2: second requirement, original wording | ✅ | |"];

  test("a new criterion with every row ticked: ok AC-5", async () => {
    const { run } = fakeGit(boundaryAnswer);
    const gate = await roundGate(run, "/repo", reopenedStatus(ticked), BOUNDARY_DESCRIPTION + "- **AC-3:** new\n");
    expect(gate).toEqual({ ok: true });
  });
  test("nothing new, everything ticked: refused, not ok-by-default AC-5", async () => {
    const { run } = fakeGit(boundaryAnswer);
    const gate = await roundGate(run, "/repo", reopenedStatus(ticked), BOUNDARY_DESCRIPTION);
    expect(gate).toEqual({ ok: false });
  });
  test("a reworded criterion whose row is unticked: ok AC-5", async () => {
    const { run } = fakeGit(boundaryAnswer);
    const rows = ["| AC-1: first requirement | ✅ | |", "| AC-2: second requirement, reworded | ⬜ | |"];
    const description = "- **AC-1:** first requirement\n- **AC-2:** second requirement, reworded\n";
    const gate = await roundGate(run, "/repo", reopenedStatus(rows), description);
    expect(gate).toEqual({ ok: true });
  });
  test("a reworded criterion whose row is still ticked: refused AC-5", async () => {
    const { run } = fakeGit(boundaryAnswer);
    const description = "- **AC-1:** first requirement\n- **AC-2:** second requirement, reworded\n";
    const gate = await roundGate(run, "/repo", reopenedStatus(ticked), description);
    expect(gate).toEqual({ ok: false });
  });
  test("a spec never reopened, all ticked: notHeldBack AC-5", async () => {
    const { run } = fakeGit({});
    const gate = await roundGate(run, "/repo", acceptanceStatus(ticked), BOUNDARY_DESCRIPTION);
    expect(gate).toEqual({ notHeldBack: true });
  });
});

describe("roundGate with a Failed row (spec 510)", () => {
  const boundaryAnswer = { "show abc1234:./1-description.md": { code: 0, stdout: BOUNDARY_DESCRIPTION } };
  const reopenedStatus = (rows: string[]) => `${ARCHIVED}\n${STAMP}\n\n` + acceptanceStatus(rows);
  const ok = "| AC-1: first requirement | ✅ | |";

  test("an open row whose note starts Failed: counts as changed, nothing reworded (AC-9)", async () => {
    const { run } = fakeGit(boundaryAnswer);
    const rows = [ok, "| AC-2: second requirement, original wording | ⬜ | Failed: the log shows no row |"];
    expect(await roundGate(run, "/repo", reopenedStatus(rows), BOUNDARY_DESCRIPTION)).toEqual({ ok: true });
  });
  test("the same open row without the Failed: note is refused (AC-9)", async () => {
    const { run } = fakeGit(boundaryAnswer);
    const rows = [ok, "| AC-2: second requirement, original wording | ⬜ | Not tested: x |"];
    expect(await roundGate(run, "/repo", reopenedStatus(rows), BOUNDARY_DESCRIPTION)).toEqual({ ok: false });
  });
  test("a ticked row keeping a Failed: note is no change (AC-9)", async () => {
    const { run } = fakeGit(boundaryAnswer);
    const rows = [ok, "| AC-2: second requirement, original wording | ✅ | Failed: fixed since |"];
    expect(await roundGate(run, "/repo", reopenedStatus(rows), BOUNDARY_DESCRIPTION)).toEqual({ ok: false });
  });
  test("no boundary stamp: still notHeldBack (AC-9)", async () => {
    const { run } = fakeGit({});
    const rows = ["| AC-1: first requirement | ⬜ | Failed: x |"];
    expect(await roundGate(run, "/repo", acceptanceStatus(rows), BOUNDARY_DESCRIPTION)).toEqual({ notHeldBack: true });
  });
});
