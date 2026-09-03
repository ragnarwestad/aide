// Split out of specs-pull.test.ts by theme.
//
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

import { describe, expect, test } from "bun:test";
import { pullFastForward } from "../../src/git/specs-pull.ts";
import { fakeGit } from "../helpers/fake-git.ts";

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
    "merge -q --ff-only origin/": { code: 0 },
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
