// Spec 150: the Update button's pull.
//
// The dashboard reads spec folders straight off the serving host's
// checkout, which a cron pulls every two minutes — so a description
// pushed from another machine is invisible for up to two minutes and
// nothing on the page says which version is on the screen. The button
// closes that gap, and it has to be as safe unattended as the cron is:
// `core/scripts/aide-pull-specs`'s own four checks, in TypeScript, over
// one repo instead of a list.
//
// One difference from the script, and it is deliberate: a checkout that
// cannot fast-forward is detected BEFORE anything is pulled, so the
// reader is told which of the four things went wrong rather than
// "pull failed".

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pullFastForward, saveSpecFile } from "../src/specs-pull.ts";
import { fakeGit } from "./helpers/fake-git.ts";

const DIR = "/host/aide-specs/aide/150-one-page-shows-the-whole-spec";
const TOP = "/host/aide-specs";

/** A checkout that passes every check, standing one commit behind. */
const behind = (extra: Record<string, { code: number; stdout?: string }> = {}) =>
  fakeGit({
    "rev-parse --show-toplevel": { code: 0, stdout: `${TOP}\n` },
    "diff --quiet HEAD": { code: 0 },
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
    fetch: { code: 0 },
    "merge-base --is-ancestor": { code: 0 },
    "merge -q --ff-only": { code: 0 },
    ...extra,
  });

/** `rev-parse HEAD` answers twice — before the merge and after — so the
 *  result can say whether the checkout actually moved. */
const movingHead = (before: string, after: string) => {
  let seen = 0;
  return (args: string[]): { code: number; stdout: string } | null =>
    args.join(" ") === "rev-parse HEAD" ? { code: 0, stdout: `${seen++ === 0 ? before : after}\n` } : null;
};

const base = async () => "main";

describe("pullFastForward", () => {
  test("a checkout behind origin is fast-forwarded, and says how far it moved", async () => {
    const heads = movingHead("a3f9c21aaaaaaa", "7b1e004bbbbbbb");
    const git = behind();
    const run = async (dir: string, args: string[]) => heads(args) ?? (await git.run(dir, args));
    const result = await pullFastForward(run, DIR, base);
    expect(result.ok).toBe(true);
    expect(result.moved).toBe(true);
    expect(result.note).toContain("a3f9c21");
    expect(result.note).toContain("7b1e004");
  });

  test("a checkout already up to date says so, and is not a failure", async () => {
    const heads = movingHead("a3f9c21aaaaaaa", "a3f9c21aaaaaaa");
    const git = behind();
    const run = async (dir: string, args: string[]) => heads(args) ?? (await git.run(dir, args));
    const result = await pullFastForward(run, DIR, base);
    expect(result.ok).toBe(true);
    expect(result.moved).toBe(false);
    expect(result.note).toContain("already up to date");
  });

  // Every git command runs at the top of the working tree, not in the
  // spec folder the page happens to be about: `git merge` refuses to
  // run from a subdirectory, and the pull is about the whole repo.
  test("git runs at the top of the work tree, whatever folder was asked about", async () => {
    const heads = movingHead("a3f9c21", "7b1e004");
    const git = behind();
    const run = async (dir: string, args: string[]) => {
      const answer = heads(args);
      if (answer) {
        git.calls.push({ dir, args });
        return answer;
      }
      return git.run(dir, args);
    };
    await pullFastForward(run, DIR, base);
    // The first call is the one that ASKS where the top is.
    expect(git.calls[0]!.dir).toBe(DIR);
    expect(git.calls.slice(1).map((c) => c.dir)).not.toContain(DIR);
    for (const call of git.calls.slice(1)) expect(call.dir).toBe(TOP);
  });

  test("a directory that is not a git working tree is refused, and nothing else is run", async () => {
    const git = behind({ "rev-parse --show-toplevel": { code: 128 } });
    const result = await pullFastForward(git.run, DIR, base);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("not a git working tree");
    expect(git.calls).toHaveLength(1);
  });

  test("uncommitted changes are refused, and nothing is pulled", async () => {
    const git = behind({ "diff --quiet HEAD": { code: 1 } });
    const result = await pullFastForward(git.run, DIR, base);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("uncommitted changes");
    expect(git.calls.map((c) => c.args.join(" "))).not.toContain("merge -q --ff-only refs/remotes/origin/main");
  });

  test("a checkout parked on a spec branch is left alone", async () => {
    const git = behind({ "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "aide/150-one-page\n" } });
    const result = await pullFastForward(git.run, DIR, base);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("aide/150-one-page");
    expect(result.note).toContain("main");
    expect(git.calls.map((c) => c.args[0])).not.toContain("merge");
  });

  test("a repo with no default branch on origin is refused, not guessed at", async () => {
    const git = behind();
    const result = await pullFastForward(git.run, DIR, async () => null);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("default branch");
    expect(git.calls.map((c) => c.args[0])).not.toContain("merge");
  });

  // The one place this parts company with `aide-pull-specs`, which
  // reports a divergence and a broken remote as the same "pull failed".
  test("a checkout that has diverged is told apart from a pull that failed", async () => {
    const diverged = behind({ "merge-base --is-ancestor": { code: 1 } });
    const result = await pullFastForward(diverged.run, DIR, base);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("fast-forward");
    // Detected BEFORE the merge, so nothing was attempted.
    expect(diverged.calls.map((c) => c.args[0])).not.toContain("merge");

    const broken = behind({ "merge -q --ff-only": { code: 1 } });
    const failed = await pullFastForward(broken.run, DIR, base);
    expect(failed.ok).toBe(false);
    expect(failed.note).not.toBe(result.note);
  });

  test("an unreachable origin is its own reason", async () => {
    const git = behind({ fetch: { code: 128 } });
    const result = await pullFastForward(git.run, DIR, base);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("origin");
    expect(git.calls.map((c) => c.args[0])).not.toContain("merge");
  });

  // The reader pressed a button; a git that cannot be spawned at all is
  // an answer on the page, not a 500.
  test("git blowing up is a refusal like any other, never a throw", async () => {
    const result = await pullFastForward(
      async () => {
        throw new Error("git: command not found");
      },
      DIR,
      base,
    );
    expect(result.ok).toBe(false);
    expect(result.note).toContain("git");
  });
});

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
    "merge -q --ff-only": { code: 0 },
    "log -1 --format=": { code: 0, stdout: `${FILE_SHA}\t2026-08-21T09:14:00+02:00\n` },
    add: { code: 0 },
    commit: { code: 0 },
    push: { code: 0 },
    "reset --hard": { code: 0 },
    ...extra,
  });

const edit = (text: string, baseSha: string | null = FILE_SHA) => ({
  file: FILE,
  text,
  baseSha,
  specLabel: "162-edit-a-spec-on-its-own-page",
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
      ["an unreachable origin", { fetch: { code: 128 } }, "origin"],
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
