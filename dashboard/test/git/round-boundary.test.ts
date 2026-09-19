// Spec 471, AC-6: the per-AC-n-row git diff a held-back round's gate
// reads — one line at a time, against the repo's own FakeGitRunner
// convention (dashboard/CLAUDE.md's plan review note), never a real git
// process.

import { describe, expect, test } from "bun:test";
import { acRowsAt, acRowsFromText, criteriaMovedOn } from "../../src/git/round-boundary.ts";
import { fakeGit } from "../helpers/fake-git.ts";
import { createGitRunner } from "../../src/git/branch-status.ts";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    const { run } = fakeGit({ "show deadbee:./1-description.md": { code: 0, stdout: BOUNDARY_DESCRIPTION } });
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

// Criterion 12: a real repository, one folder per project, as the specs
// repository is. `git show <sha>:1-description.md` is relative to the
// repository root, which is not where a spec's description lives.
describe("acRowsAt against a real repository", () => {
  const git = createGitRunner();
  const desc = (second: string) =>
    `# X\n\n## Acceptance criteria\n\n- **AC-1:** first\n- **AC-2:** ${second}\n`;

  async function repo(): Promise<{ root: string; sha: string }> {
    const root = mkdtempSync(join(tmpdir(), "round-boundary-"));
    const g = async (...a: string[]) => {
      const r = await git(root, ["-c", "user.name=t", "-c", "user.email=t@t", ...a]);
      expect(r.code).toBe(0);
      return r.stdout.trim();
    };
    await g("init", "-q");
    mkdirSync(join(root, "proj", "archive", "7-arch"), { recursive: true });
    mkdirSync(join(root, "proj", "8-active"), { recursive: true });
    writeFileSync(join(root, "proj", "archive", "7-arch", "1-description.md"), desc("orig"));
    writeFileSync(join(root, "proj", "8-active", "1-description.md"), desc("orig"));
    await g("add", "-A");
    await g("commit", "-q", "-m", "boundary");
    const sha = await g("rev-parse", "HEAD");
    return { root, sha };
  }

  test("a spec archived at the boundary is read under archive/<folder>, even after it moved out AC-12", async () => {
    const { root, sha } = await repo();
    try {
      renameSync(join(root, "proj", "archive", "7-arch"), join(root, "proj", "7-arch"));
      const rows = await acRowsAt(git, join(root, "proj", "7-arch"), sha);
      expect(rows.get("AC-2")).toBe("orig");
      const now = acRowsFromText(desc("reworded"));
      expect(criteriaMovedOn(now, ["AC-2"], rows)).toBe(true);
      expect(criteriaMovedOn(acRowsFromText(desc("orig")), ["AC-2"], rows)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a spec active at the boundary is read in its own folder AC-12", async () => {
    const { root, sha } = await repo();
    try {
      const rows = await acRowsAt(git, join(root, "proj", "8-active"), sha);
      expect(rows.get("AC-1")).toBe("first");
      expect(criteriaMovedOn(acRowsFromText(desc("orig")), ["AC-2"], rows)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
