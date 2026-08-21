// Spec 150: the Update button's pull.
//
// The dashboard lists specs by reading the spec folders straight off the
// serving host's working copy, which `aide-pull-specs` pulls from cron
// every two minutes. A description edited and pushed from another
// machine is therefore invisible for up to two minutes, and nothing on
// the page said which version it was showing — the user had to be told
// "wait a couple of minutes" before re-running a cancelled job, which is
// not a process. The button closes that gap and lets a reader SEE that
// the dashboard has the change before pressing Run.
//
// It has to be as safe unattended as the cron is, so it asks the same
// four questions `core/scripts/aide-pull-specs:41-104` asks, in
// TypeScript, over one repo instead of a list: is this a git working
// tree, is there anything uncommitted, is it on its own default branch,
// and is the pull a fast-forward. A repo failing any of them is left
// exactly as it was, with the reason on the page.
//
// One deliberate difference from the script. There, a divergence and an
// unreachable remote are both "pull failed" — a fine answer for a cron
// mail, and no answer at all for a person who just pressed a button. So
// the fast-forward is CHECKED, against a ref the fetch has just moved,
// before anything is merged.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GitRunner } from "./branch-status.ts";
import { lastCommitOf } from "./description-freshness.ts";

export interface SpecsPullResult {
  ok: boolean;
  /** One sentence for the reader: why nothing was pulled, or what the
   *  pull did. Both ride back on the redirect, so both are prose. */
  note: string;
  /** Whether the checkout actually moved. "Already up to date" is a
   *  success and is not the same news. */
  moved: boolean;
}

const refuse = (note: string): SpecsPullResult => ({ ok: false, note, moved: false });

const short = (sha: string | null): string => (sha ?? "").slice(0, 7) || "unknown";

/** Fast-forward the working tree `dir` sits in, or say why not.
 *
 *  `dir` is the SPEC folder the reader was looking at, not the repo:
 *  the first thing asked is where the top of the work tree is, and
 *  everything after that runs there. `git merge` refuses to run from a
 *  subdirectory, and the pull is about the whole repo in any case.
 *
 *  `resolveBase` is passed in rather than re-derived, for the reason
 *  `mergeBranchIntoDefault` gives: `BranchStatusChecker.defaultBranch()`
 *  is public precisely so one resolver answers "which branch is the
 *  default" for every caller. */
export async function pullFastForward(
  run: GitRunner,
  dir: string,
  resolveBase: (root: string) => Promise<string | null>,
): Promise<SpecsPullResult> {
  try {
    const top = await run(dir, ["rev-parse", "--show-toplevel"]);
    if (top.code !== 0) return refuse(`${dir} is not a git working tree — nothing was pulled`);
    const root = top.stdout.trim();

    // Uncommitted work of ANY kind, tracked files only: an untracked
    // file is no obstacle to a fast-forward, and a specs root collects
    // those (editor scratch, exports) between commits.
    const dirty = await run(root, ["diff", "--quiet", "HEAD"]);
    if (dirty.code !== 0) {
      return refuse(`the specs checkout has uncommitted changes — nothing was pulled`);
    }

    const base = await resolveBase(root);
    if (!base) return refuse(`the specs checkout has no default branch on origin — nothing was pulled`);
    const current = await run(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const on = current.stdout.trim();
    if (current.code !== 0 || on !== base) {
      // A checkout parked on a spec branch is left alone: pulling it
      // would fetch a branch whose upstream may be gone.
      return refuse(`the specs checkout is on ${on || "an unknown branch"}, not ${base} — nothing was pulled`);
    }

    const fetched = await run(root, ["fetch", "--quiet", "origin", base]);
    if (fetched.code !== 0) return refuse(`origin could not be reached — nothing was pulled`);

    // Before the merge, so a divergence is its own answer rather than
    // whatever git says when the merge refuses.
    const ref = `refs/remotes/origin/${base}`;
    const ancestor = await run(root, ["merge-base", "--is-ancestor", "HEAD", ref]);
    if (ancestor.code !== 0) {
      return refuse(
        `the specs checkout has commits origin does not, so it cannot fast-forward — ` +
          `nothing was pulled, merge it by hand`,
      );
    }

    const before = await run(root, ["rev-parse", "HEAD"]);
    const merged = await run(root, ["merge", "-q", "--ff-only", ref]);
    if (merged.code !== 0) return refuse(`the pull failed — nothing was pulled`);
    const after = await run(root, ["rev-parse", "HEAD"]);

    const from = before.code === 0 ? before.stdout.trim() : null;
    const to = after.code === 0 ? after.stdout.trim() : null;
    if (from && to && from === to) {
      return { ok: true, moved: false, note: "the specs checkout was already up to date" };
    }
    return { ok: true, moved: true, note: `pulled the specs checkout: ${short(from)} → ${short(to)}` };
  } catch (err) {
    // The reader pressed a button. A git that cannot be spawned at all
    // is an answer on the page, never a 500.
    return refuse(`git could not be run: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Spec 162: Save, on the same checkout.
//
// The dashboard has written to git in exactly one other place —
// `mergeBranchIntoDefault` — and one of its decisions is deliberately
// NOT copied here. There, a push that fails leaves the commit, because
// "a push problem is not a reason to undo committed work": that commit
// is a step's real, already-reviewed output. This commit exists only to
// reach origin. The person who made it is still looking at the browser
// tab and can press Save again, and an unpushed commit left in the ONE
// shared specs checkout silently breaks the next fast-forward — the
// cron's and the Update button's alike — for every project in it. So a
// push that fails, or a commit that fails, is reset away.
//
// Everything else follows the pull above: ask git the boring questions
// first, refuse by name, never throw.

export interface SpecsSaveResult {
  ok: boolean;
  /** One sentence for the reader, on the redirect, exactly as the
   *  pull's is. */
  note: string;
  /** Whether a commit was actually made. Text identical to what is
   *  already committed is a success that changed nothing, and the page
   *  must not claim a version it did not write. */
  committed: boolean;
}

/** What a browser actually posts, made into what belongs in the file.
 *
 *  A textarea is submitted with CRLF line endings whatever the file
 *  had, so writing the value through would show every line of a
 *  4000-byte description as changed and turn an untouched save into a
 *  commit. The trailing newline is the same kind of hygiene: a text
 *  file ends with one, and without this a save would strip the file's
 *  and the next one would put it back. */
const asFileText = (text: string): string => {
  const lf = text.replace(/\r\n/g, "\n");
  return lf === "" || lf.endsWith("\n") ? lf : `${lf}\n`;
};

/** Write one file in the specs checkout `dir` sits in, commit it and
 *  push it — or say why not, having changed nothing.
 *
 *  `dir` is the SPEC folder, as it is for `pullFastForward`: the file
 *  is written there, and the questions about the repo are asked at the
 *  top of the work tree.
 *
 *  `baseSha` is the commit the reader's copy of the text was read at,
 *  carried through the form. The page is rendered once and a reader may
 *  sit on it for minutes while an analyze step lands a new version of
 *  the very file, so a save whose file has moved since is refused —
 *  never merged, never clobbered. `null` is the ordinary answer for a
 *  description git has never committed. */
export async function saveSpecFile(
  run: GitRunner,
  dir: string,
  resolveBase: (root: string) => Promise<string | null>,
  edit: { file: string; text: string; baseSha: string | null; specLabel: string },
): Promise<SpecsSaveResult> {
  const { file } = edit;
  try {
    // A checkout that cannot be fast-forwarded cannot be pushed either,
    // and the four reasons it gives are the ones a reader needs. Run
    // first, so nothing is written for a checkout that was never going
    // to take it.
    const pulled = await pullFastForward(run, dir, resolveBase);
    if (!pulled.ok) return { ok: false, note: pulled.note, committed: false };

    const top = await run(dir, ["rev-parse", "--show-toplevel"]);
    const root = top.stdout.trim();

    const current = await lastCommitOf(run, dir, file);
    if ((current?.sha ?? null) !== edit.baseSha) {
      return {
        ok: false,
        note: `${file} has changed since you opened it for editing — nothing was saved, open it again`,
        committed: false,
      };
    }

    // Captured BEFORE the write, so a rollback undoes exactly this
    // save's commit and nothing the pull above brought in.
    const before = await run(root, ["rev-parse", "HEAD"]);
    const path = join(dir, file);
    const previous = readFileSync(path, "utf-8");
    writeFileSync(path, asFileText(edit.text));

    const added = await run(dir, ["add", "--", file]);
    if (added.code !== 0) {
      writeFileSync(path, previous);
      return { ok: false, note: `${file} could not be staged — nothing was saved`, committed: false };
    }

    // Nothing staged means the text is what was already committed. No
    // empty commit, no push, and the page must not stamp a new version
    // onto a file that did not move.
    //
    // Asked from `dir`, NOT from `root`. `file` is a bare filename —
    // `1-description.md` — which names the file from the spec's own
    // folder and names NOTHING from the repository root. Asked there it
    // matched an empty pathspec, git answered "no difference" with exit
    // 0, and every save took this branch: the text was written and
    // staged, the commit and the push never ran, and the page reported
    // success. What it left behind was the reader's edit sitting
    // uncommitted in the shared checkout — which is exactly what the
    // next pull, this button's or the cron's, refuses (2026-08-21, the
    // first real save anyone made).
    const staged = await run(dir, ["diff", "--cached", "--quiet", "HEAD", "--", file]);
    if (staged.code === 0) {
      return { ok: true, note: `${file} is unchanged — nothing was saved`, committed: false };
    }

    const message = `Edit ${file} for ${edit.specLabel} from the dashboard`;
    const committed = await run(root, ["commit", "-q", "-m", message]);
    if (committed.code !== 0) {
      // The write is staged at this point, so the shared checkout is
      // dirty — and a dirty checkout is what the next pull, this
      // button's or the cron's, refuses.
      await run(root, ["reset", "--hard", before.stdout.trim()]);
      return { ok: false, note: `${file} could not be committed — nothing was saved`, committed: false };
    }

    const pushed = await run(root, ["push", "-q", "origin", "HEAD"]);
    if (pushed.code !== 0) {
      await run(root, ["reset", "--hard", before.stdout.trim()]);
      return {
        ok: false,
        note: `${file} was committed but the push to origin failed — nothing was kept, try again`,
        committed: false,
      };
    }
    return { ok: true, note: `saved ${file}`, committed: true };
  } catch (err) {
    // A reader pressed a button: git that cannot be spawned, or a file
    // that cannot be written, is an answer on the page and never a 500.
    return {
      ok: false,
      note: `${file} could not be saved: ${err instanceof Error ? err.message : String(err)}`,
      committed: false,
    };
  }
}
