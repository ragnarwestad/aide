// Split out of specs-pull.test.ts by theme.
//
// Spec 162: Save, on the same checkout.
//
// The pull above is read-only apart from a fast-forward merge; this
// writes a file, commits it and pushes it, which is the second place
// this dashboard has ever written to git. It asks the pull's own four
// questions first — a checkout that cannot be fast-forwarded cannot be
// pushed either — and then two more of its own: has the file moved
// since the reader opened it, and did the text actually change.
//
// The failure policy is deliberately NOT `branch-merge.ts`'s. There a
// failed push leaves the commit, because that commit is a step's real
// work. Here the commit exists only to reach origin, and one left
// behind in the ONE shared specs checkout breaks the next fast-forward
// for every project in it — so a push that fails is reset away.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveSpecFile, saveSpecFiles } from "../../../src/git/specs-pull.ts";
import { fakeGit } from "../../helpers/fake-git.ts";

const base = async () => "main";

const FILE = "1-description.md";
const ORIGINAL = "# A spec - Description\n\n## Description\n\nAs it was.\n";
const HEAD_SHA = "1111111aaaaaaa";
const FILE_SHA = "a3f9c21aaaaaaa";

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

/** A real specs checkout on disk — the file is genuinely written, so
 *  "nothing was saved" is a claim about the bytes and not about which
 *  git commands were issued. Git itself is still faked. */
function checkout(): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), "aide-save-"));
  roots.push(root);
  const dir = join(root, "aide", "162-edit-a-spec-on-its-own-page");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, FILE), ORIGINAL);
  return { root, dir };
}

/** The pull's answers, plus the ones only a save asks for: which commit
 *  last touched the file, where HEAD is, and whether the write staged
 *  anything. Everything succeeds unless a test says otherwise. */
const savable = (root: string, extra: Record<string, { code: number; stdout?: string }> = {}) =>
  fakeGit({
    "rev-parse --show-toplevel": { code: 0, stdout: `${root}\n` },
    "diff --cached --quiet HEAD": { code: 1 },
    "diff --quiet HEAD": { code: 0 },
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
    "rev-parse HEAD": { code: 0, stdout: `${HEAD_SHA}\n` },
    fetch: { code: 0 },
    "merge-base --is-ancestor": { code: 0 },
    "merge -q --ff-only origin/": { code: 0 },
    "merge -q --ff-only": { code: 0 },
    "log -1 --format=": { code: 0, stdout: `${FILE_SHA}\t2026-08-21T09:14:00+02:00\n` },
    add: { code: 0 },
    commit: { code: 0 },
    push: { code: 0 },
    "reset --hard": { code: 0 },
    ...extra,
  });

// `message` became the caller's in spec 182, when the tick on a spec's
// page needed to record something the description editor's sentence
// does not say. Stated here exactly as the save route states it.
const edit = (text: string, baseSha: string | null = FILE_SHA) => ({
  file: FILE,
  text,
  baseSha,
  specLabel: "162-edit-a-spec-on-its-own-page",
  message: `Edit ${FILE} for 162-edit-a-spec-on-its-own-page from the dashboard`,
});

const NEW_TEXT = "# A spec - Description\n\n## Description\n\nAs it is now.\n";

describe("saveSpecFile", () => {
  test("a matching base sha writes the file, commits it and pushes it", async () => {
    const { root, dir } = checkout();
    const git = savable(root);
    const result = await saveSpecFile(git.run, dir, base, edit(NEW_TEXT));
    expect(result.ok).toBe(true);
    expect(result.committed).toBe(true);
    expect(readFileSync(join(dir, FILE), "utf-8")).toBe(NEW_TEXT);
    const lines = git.calls.map((c) => c.args.join(" "));
    expect(lines.some((l) => l.startsWith("add"))).toBe(true);
    expect(lines.some((l) => l.startsWith("commit"))).toBe(true);
    expect(lines.some((l) => l.startsWith("push"))).toBe(true);
    expect(lines.some((l) => l.startsWith("reset"))).toBe(false);
  });

  // The fake answers by COMMAND and ignores the directory, which is how
  // the first real save got past this suite: `file` is a bare name, so
  // the staged-check asked from the repository root matched an empty
  // pathspec, git said "no difference", and the save returned success
  // having written and staged the text without committing it. The rule
  // the fake cannot see is that a bare pathspec must be asked where it
  // means something — the same directory the `add` used.
  test("the staged-check is asked where the bare filename means something", async () => {
    const { root, dir } = checkout();
    const git = savable(root);
    await saveSpecFile(git.run, dir, base, edit(NEW_TEXT));
    const add = git.calls.find((c) => c.args[0] === "add")!;
    const staged = git.calls.find((c) => c.args.join(" ").startsWith("diff --cached"))!;
    expect(staged.dir).toBe(add.dir);
    expect(staged.dir).toBe(dir);
  });

  test("the commit says which spec, which file, and that a person did it", async () => {
    const { root, dir } = checkout();
    const git = savable(root);
    await saveSpecFile(git.run, dir, base, edit(NEW_TEXT));
    const message = git.calls.find((c) => c.args[0] === "commit")!.args.join(" ");
    expect(message).toContain(FILE);
    expect(message).toContain("162-edit-a-spec-on-its-own-page");
    expect(message).toContain("dashboard");
    // Never the runner's grammar: `workflow-history.ts` counts a step
    // by a commit subject beginning "Run /aide-", and a hand edit is
    // not a step the spec has had.
    expect(message).not.toContain("Run /aide-");
  });

  test("a base sha that has moved since the page was rendered is refused, and nothing is written", async () => {
    const { root, dir } = checkout();
    const git = savable(root);
    const result = await saveSpecFile(git.run, dir, base, edit(NEW_TEXT, "0000000bbbbbbb"));
    expect(result.ok).toBe(false);
    expect(result.note).toContain("changed since");
    expect(readFileSync(join(dir, FILE), "utf-8")).toBe(ORIGINAL);
    expect(git.calls.map((c) => c.args[0])).not.toContain("commit");
    expect(git.calls.map((c) => c.args[0])).not.toContain("push");
  });

  test("a checkout the pull would refuse is refused here too, before any write", async () => {
    for (const [what, extra, expected] of [
      ["uncommitted changes", { "diff --quiet HEAD": { code: 1 } }, "uncommitted"],
      ["a spec branch", { "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "aide/162-edit\n" } }, "aide/162-edit"],
      ["a divergence", { "merge-base --is-ancestor": { code: 1 } }, "fast-forward"],
      ["an unreachable origin", { fetch: { code: 128 } }, "Origin"],
    ] as [string, Record<string, { code: number; stdout?: string }>, string][]) {
      const { root, dir } = checkout();
      const git = savable(root, extra);
      const result = await saveSpecFile(git.run, dir, base, edit(NEW_TEXT));
      expect([what, result.ok]).toEqual([what, false]);
      expect([what, result.note.includes(expected)]).toEqual([what, true]);
      expect([what, readFileSync(join(dir, FILE), "utf-8")]).toEqual([what, ORIGINAL]);
      expect([what, git.calls.map((c) => c.args[0]).includes("push")]).toEqual([what, false]);
    }
  });

  test("text identical to what is committed is a success that commits nothing", async () => {
    const { root, dir } = checkout();
    const git = savable(root, { "diff --cached --quiet HEAD": { code: 0 } });
    const result = await saveSpecFile(git.run, dir, base, edit(ORIGINAL));
    expect(result.ok).toBe(true);
    expect(result.committed).toBe(false);
    expect(result.note).toContain("nothing");
    expect(git.calls.map((c) => c.args[0])).not.toContain("commit");
    expect(git.calls.map((c) => c.args[0])).not.toContain("push");
  });

  // A browser posts a textarea with CRLF line endings, whatever the
  // file had. Written through, every line of a 4000-byte description
  // would show as changed and an untouched save would be a commit.
  test("a browser's CRLF line endings are not a change", async () => {
    const { root, dir } = checkout();
    const git = savable(root, { "diff --cached --quiet HEAD": { code: 0 } });
    const result = await saveSpecFile(git.run, dir, base, edit(ORIGINAL.replace(/\n/g, "\r\n")));
    expect(result.ok).toBe(true);
    expect(readFileSync(join(dir, FILE), "utf-8")).toBe(ORIGINAL);
    expect(git.calls.map((c) => c.args[0])).not.toContain("commit");
  });

  test("a push that fails is rolled back to the commit before the write, and says so", async () => {
    const { root, dir } = checkout();
    const git = savable(root, { push: { code: 1 } });
    const result = await saveSpecFile(git.run, dir, base, edit(NEW_TEXT));
    expect(result.ok).toBe(false);
    expect(result.note).toContain("push");
    const reset = git.calls.find((c) => c.args[0] === "reset");
    expect(reset).toBeDefined();
    expect(reset!.args).toContain(HEAD_SHA);
    expect(reset!.args).toContain("--hard");
  });

  // Nothing half-done in the ONE shared checkout: a write that was
  // staged but not committed would leave it dirty, and the next pull —
  // this button's or the cron's — refuses a dirty checkout.
  test("a commit that fails is rolled back too, so the checkout is left clean", async () => {
    const { root, dir } = checkout();
    const git = savable(root, { commit: { code: 1 } });
    const result = await saveSpecFile(git.run, dir, base, edit(NEW_TEXT));
    expect(result.ok).toBe(false);
    expect(result.note).toContain("nothing was saved");
    expect(git.calls.find((c) => c.args[0] === "reset")!.args).toContain("--hard");
    expect(git.calls.map((c) => c.args[0])).not.toContain("push");
  });

  // A spec whose description was never committed has no base commit to
  // carry, and saving it is the ordinary case — not a mismatch.
  test("a file git has never committed saves against no base at all", async () => {
    const { root, dir } = checkout();
    const git = savable(root, { "log -1 --format=": { code: 0, stdout: "\n" } });
    const result = await saveSpecFile(git.run, dir, base, edit(NEW_TEXT, null));
    expect(result.ok).toBe(true);
    expect(readFileSync(join(dir, FILE), "utf-8")).toBe(NEW_TEXT);
  });

  test("git blowing up is a refusal like any other, never a throw", async () => {
    const { dir } = checkout();
    const result = await saveSpecFile(
      async () => {
        throw new Error("git: command not found");
      },
      dir,
      base,
      edit(NEW_TEXT),
    );
    expect(result.ok).toBe(false);
    expect(result.note).toContain("git");
  });
});

// --- spec 188: two files, one commit ----------------------------------------
//
// Ticking a check is part of editing the spec now: one Save can carry
// both a new `1-description.md` and a `4-status.md` with a row flipped,
// and "one action" means ONE commit. `saveSpecFile` above is the same
// function with one edit in it, so everything it already proves still
// holds; what is new is what happens when one of several edits refuses.
//
// The order is what decides it. Every edit's `baseSha` is checked
// BEFORE any file is written — a guard run file-by-file would leave the
// first file written and staged in the ONE shared specs checkout while
// the second one's refusal aborts the commit, and a dirty checkout is
// what the next pull, this button's or the cron's, refuses.

describe("saveSpecFiles", () => {
  const STATUS_FILE = "4-status.md";
  const STATUS_SHA = FILE_SHA;
  const STATUS_ORIGINAL = [
    "# A spec - Status",
    "",
    "## Phase 4: REFACTOR - Test suite",
    "",
    "| Task | Status | Notes |",
    "|------|--------|-------|",
    "| Manual check at 375px | ⬜ | |",
    "",
  ].join("\n");
  const STATUS_TICKED = STATUS_ORIGINAL.replace("| Manual check at 375px | ⬜ | |", "| Manual check at 375px | ✅ | |");

  /** Both files on disk, so "nothing was written" is a claim about the
   *  bytes of both. */
  const twoFileCheckout = (): { root: string; dir: string } => {
    const made = checkout();
    writeFileSync(join(made.dir, STATUS_FILE), STATUS_ORIGINAL);
    return made;
  };

  /** The same checkout `saveSpecFile` is tested against. Both files
   *  last moved at the same commit, which is the ordinary case — a
   *  step's own run writes them together — so a stale test says so by
   *  posting the wrong sha, not by moving one file. */
  const twoFileGit = (root: string, extra: Record<string, { code: number; stdout?: string }> = {}) =>
    savable(root, extra);

  const edits = (over: { text?: string; baseSha?: string | null; statusText?: string; statusBaseSha?: string | null } = {}) => [
    { file: FILE, text: over.text ?? NEW_TEXT, baseSha: over.baseSha === undefined ? FILE_SHA : over.baseSha },
    {
      file: STATUS_FILE,
      text: over.statusText ?? STATUS_TICKED,
      baseSha: over.statusBaseSha === undefined ? STATUS_SHA : over.statusBaseSha,
    },
  ];

  const OPTS = {
    specLabel: "162-edit-a-spec-on-its-own-page",
    message: "Edit 1-description.md and tick a check in 4-status.md",
  };

  test("two changed files land in ONE commit and one push", async () => {
    const { root, dir } = twoFileCheckout();
    const git = twoFileGit(root);
    const result = await saveSpecFiles(git.run, dir, base, edits(), OPTS);
    expect(result.ok).toBe(true);
    expect(result.committed).toBe(true);
    expect(readFileSync(join(dir, FILE), "utf-8")).toBe(NEW_TEXT);
    expect(readFileSync(join(dir, STATUS_FILE), "utf-8")).toBe(STATUS_TICKED);
    expect(git.calls.filter((c) => c.args[0] === "commit")).toHaveLength(1);
    expect(git.calls.filter((c) => c.args[0] === "push")).toHaveLength(1);
  });

  // The staged question is asked over the SET, not once per file: one
  // unchanged file among several is not a reason to skip the commit.
  test("only one of the two actually changed: still one commit, the other file left as it was", async () => {
    const { root, dir } = twoFileCheckout();
    const git = twoFileGit(root);
    const result = await saveSpecFiles(git.run, dir, base, edits({ text: ORIGINAL }), OPTS);
    expect(result.ok).toBe(true);
    expect(result.committed).toBe(true);
    expect(readFileSync(join(dir, FILE), "utf-8")).toBe(ORIGINAL);
    expect(readFileSync(join(dir, STATUS_FILE), "utf-8")).toBe(STATUS_TICKED);
    expect(git.calls.filter((c) => c.args[0] === "commit")).toHaveLength(1);
  });

  test("neither file changed is a success that commits nothing", async () => {
    const { root, dir } = twoFileCheckout();
    const git = twoFileGit(root, { "diff --cached --quiet HEAD": { code: 0 } });
    const result = await saveSpecFiles(git.run, dir, base, edits({ text: ORIGINAL, statusText: STATUS_ORIGINAL }), OPTS);
    expect(result.ok).toBe(true);
    expect(result.committed).toBe(false);
    expect(result.note).toContain("unchanged");
    expect(git.calls.map((c) => c.args[0])).not.toContain("commit");
    expect(git.calls.map((c) => c.args[0])).not.toContain("push");
  });

  // The risk this whole function was written carefully for.
  test("one stale baseSha refuses the lot — NEITHER file is written", async () => {
    const { root, dir } = twoFileCheckout();
    const git = twoFileGit(root);
    const result = await saveSpecFiles(git.run, dir, base, edits({ statusBaseSha: "0000000ffffff" }), OPTS);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("changed since");
    expect(result.note).toContain(STATUS_FILE);
    expect(readFileSync(join(dir, FILE), "utf-8")).toBe(ORIGINAL);
    expect(readFileSync(join(dir, STATUS_FILE), "utf-8")).toBe(STATUS_ORIGINAL);
    expect(git.calls.map((c) => c.args[0])).not.toContain("commit");
  });

  // The description is the FIRST edit, so a refusal on it proves the
  // guard runs over the whole set before the first write as much as the
  // case above does — from the other end.
  test("the first edit's stale sha refuses before the second is written either", async () => {
    const { root, dir } = twoFileCheckout();
    const git = twoFileGit(root);
    const result = await saveSpecFiles(git.run, dir, base, edits({ baseSha: "0000000ffffff" }), OPTS);
    expect(result.ok).toBe(false);
    expect(result.note).toContain(FILE);
    expect(readFileSync(join(dir, FILE), "utf-8")).toBe(ORIGINAL);
    expect(readFileSync(join(dir, STATUS_FILE), "utf-8")).toBe(STATUS_ORIGINAL);
  });

  test("a push that fails resets both writes away", async () => {
    const { root, dir } = twoFileCheckout();
    const git = twoFileGit(root, { push: { code: 1 } });
    const result = await saveSpecFiles(git.run, dir, base, edits(), OPTS);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("push");
    const reset = git.calls.find((c) => c.args[0] === "reset");
    expect(reset).toBeDefined();
    expect(reset!.args).toContain("--hard");
    expect(reset!.args).toContain(HEAD_SHA);
  });

  // Both files are staged from the SPEC folder, where a bare filename
  // means something — the mistake that left the first real save
  // uncommitted in the shared checkout (2026-08-21).
  test("every file is staged, and the staged question is asked where the bare names mean something", async () => {
    const { root, dir } = twoFileCheckout();
    const git = twoFileGit(root);
    await saveSpecFiles(git.run, dir, base, edits(), OPTS);
    const added = git.calls.filter((c) => c.args[0] === "add");
    expect(added.flatMap((c) => c.args)).toContain(FILE);
    expect(added.flatMap((c) => c.args)).toContain(STATUS_FILE);
    for (const call of added) expect(call.dir).toBe(dir);
    const staged = git.calls.find((c) => c.args.join(" ").startsWith("diff --cached"))!;
    expect(staged.dir).toBe(dir);
    expect(staged.args).toContain(FILE);
    expect(staged.args).toContain(STATUS_FILE);
  });

  test("one edit is exactly what saveSpecFile already did", async () => {
    const { root, dir } = twoFileCheckout();
    const git = twoFileGit(root);
    const result = await saveSpecFiles(git.run, dir, base, [{ file: FILE, text: NEW_TEXT, baseSha: FILE_SHA }], OPTS);
    expect(result.ok).toBe(true);
    expect(result.committed).toBe(true);
    expect(readFileSync(join(dir, FILE), "utf-8")).toBe(NEW_TEXT);
    expect(readFileSync(join(dir, STATUS_FILE), "utf-8")).toBe(STATUS_ORIGINAL);
  });
});
