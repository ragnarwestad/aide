// Save, on the same checkout as the pull (`pull.ts`): write a set of spec
// files, commit them as one commit and push it — or change nothing and
// say why.
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
// Everything else follows the pull: ask git the boring questions
// first, refuse by name, never throw.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GitRunner } from "../process/index.ts";
import { lastCommitOf } from "../description-freshness.ts";
import { getErrorMessage } from "../../messages/shared/written.ts";
import { sleep, type Wait } from "../branch-merge/retry.ts";
import { REQUEST_LOCK_WAIT_MS, withCheckoutLock } from "../checkout-lock/index.ts";
import { conflictFiles } from "../../format/git-error.ts";
import { IN_THE_CHECKOUT, lockHeld, pullInCheckout, topOf } from "./pull.ts";

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
 *  Exported because a caller deciding whether the text CHANGED has to
 *  ask the same question this function answers: a save that
 *  only ticked a box must not record itself as an edit to the prose.
 *
 *  A textarea is submitted with CRLF line endings whatever the file
 *  had, so writing the value through would show every line of a
 *  4000-byte description as changed and turn an untouched save into a
 *  commit. The trailing newline is the same kind of hygiene: a text
 *  file ends with one, and without this a save would strip the file's
 *  and the next one would put it back. */
export const asFileText = (text: string): string => {
  const lf = text.replace(/\r\n/g, "\n");
  return lf === "" || lf.endsWith("\n") ? lf : `${lf}\n`;
};

/** One file's new text, and the commit the reader's copy of it was
 *  read at. */
export interface SpecFileEdit {
  file: string;
  text: string;
  /** Carried through the form. The page is rendered once and a reader
   *  may sit on it for minutes while an analyze step lands a new
   *  version of the very file, so a save whose file has moved since is
   *  refused — never merged, never clobbered. `null` is the ordinary
   *  answer for a file git has never committed. */
  baseSha: string | null;
}

/** Write a SET of files in the specs checkout `dir` sits in, commit
 *  them as one commit and push it — or say why not, having changed
 *  nothing.
 *
 *  `dir` is the SPEC folder, as it is for `pullFastForward`: the files
 *  are written there, and the questions about the repo are asked at the
 *  top of the work tree.
 *
 *  `message` is the CALLER's, because a save records different things
 *  depending on what was in it: a description edit, a
 *  check a person made that no step could make, or both at once.
 *
 *  EVERY edit's `baseSha` is checked before ANY file is written. A guard run
 *  file-by-file would leave the first file written
 *  and staged while a later one's refusal aborts the commit — and a
 *  dirty checkout is exactly what the next pull, this button's or the
 *  cron's, refuses for every project sharing this root. "Nothing was
 *  saved" is what every refusal here promises, so it has to be true of
 *  the bytes and not only of the commit. */
export async function saveSpecFiles(
  run: GitRunner,
  dir: string,
  resolveBase: (root: string) => Promise<string | null>,
  edits: SpecFileEdit[],
  opts: {
    specLabel: string;
    message: string;
    /** Runs with the checkout's lock held: it must not take that lock. */
    validate?: () => Promise<string | undefined>;
    /** Paces the polls for the checkout's lock. */
    wait?: Wait;
  },
): Promise<SpecsSaveResult> {
  // Which file a refusal is ABOUT: one file names itself, several name
  // the save. Computed once, because most of the refusals below say it.
  const subject = edits.length === 1 ? edits[0]!.file : edits.map((e) => e.file).join(" and ");
  try {
    const root = await topOf(run, dir);
    if (typeof root !== "string") return { ok: false, note: root.note, committed: false };
    // The pull, the writes, the commit and the push — and the rebase or
    // reset after a refused push — under one hold of the checkout's lock.
    const saved = await withCheckoutLock(
      root,
      () => saveInCheckout(run, dir, root, resolveBase, edits, opts, subject),
      { waitMs: REQUEST_LOCK_WAIT_MS, wait: opts.wait ?? sleep },
    );
    return saved.locked ? saved.value : { ok: false, note: lockHeld(saved.lock, "saved").text, committed: false };
  } catch (err) {
    // A reader pressed a button: git that cannot be spawned, or a file
    // that cannot be written, is an answer on the page and never a 500.
    return {
      ok: false,
      note: `${subject} could not be saved: ${err instanceof Error ? err.message : String(err)}`,
      committed: false,
    };
  }
}


const firstGitLine = (said?: string): string =>
  (said ?? "")
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "git gave no reason";
const notSaved = (note: string): SpecsSaveResult => ({ ok: false, note, committed: false });

/** The sentence for a step that failed, with the remedy every such
 *  failure here shares. */
const failedHere = (what: string): string =>
  getErrorMessage({ what, resolve: `Try again; if it keeps failing, check it ${IN_THE_CHECKOUT}.` }).text;

async function saveInCheckout(
  run: GitRunner,
  dir: string,
  root: string,
  resolveBase: (root: string) => Promise<string | null>,
  edits: SpecFileEdit[],
  opts: { message: string; specLabel: string; validate?: () => Promise<string | undefined> },
  subject: string,
): Promise<SpecsSaveResult> {
  // A checkout that cannot be fast-forwarded cannot be pushed either,
  // and the four reasons it gives are the ones a reader needs. Run
  // first, so nothing is written for a checkout that was never going
  // to take it.
  const pulled = await pullInCheckout(run, root, resolveBase);
  if (!pulled.ok) return notSaved(pulled.note);

  const moved = await editMovedSinceOpened(run, dir, edits);
  if (moved) return notSaved(`${moved} has changed since you opened it for editing — nothing was saved, open it again`);

  const validation = await opts.validate?.();
  if (validation) return notSaved(validation);

  // Captured BEFORE the writes, so a rollback undoes exactly this
  // save's commit and nothing the pull above brought in.
  const before = (await run(root, ["rev-parse", "HEAD"])).stdout.trim();
  const unstaged = await writeAndStage(run, dir, edits);
  if (unstaged) return notSaved(failedHere(`${unstaged} could not be staged — nothing was saved.`));

  // Nothing staged means every file's text is what was already
  // committed. No empty commit, no push, and the page must not stamp
  // a new version onto files that did not move. Asked over the whole
  // SET: one unchanged file among several is not a reason to skip the
  // commit.
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
  const staged = await run(dir, ["diff", "--cached", "--quiet", "HEAD", "--", ...edits.map((e) => e.file)]);
  if (staged.code === 0) {
    return { ok: true, note: `${subject} is unchanged — nothing was saved`, committed: false };
  }

  const committed = await run(root, ["commit", "-q", "-m", opts.message]);
  if (committed.code !== 0) {
    // The writes are staged at this point, so the shared checkout is
    // dirty — and a dirty checkout is what the next pull, this
    // button's or the cron's, refuses.
    await run(root, ["reset", "--hard", before]);
    return notSaved(failedHere(`${subject} could not be committed — nothing was saved.`));
  }
  return pushOrUndo(run, root, resolveBase, { before, specLabel: opts.specLabel, subject });
}

/** The first edit whose file has a different last commit than the one
 *  the reader's copy was read at, or `null` when none has moved. */
async function editMovedSinceOpened(run: GitRunner, dir: string, edits: SpecFileEdit[]): Promise<string | null> {
  for (const edit of edits) {
    const current = await lastCommitOf(run, dir, edit.file);
    if ((current?.sha ?? null) !== edit.baseSha) return edit.file;
  }
  return null;
}

/** Write every edit and stage it. On a file git will not stage, every
 *  file is put back as it was and that file's name is the answer;
 *  `null` when all are staged. */
async function writeAndStage(run: GitRunner, dir: string, edits: SpecFileEdit[]): Promise<string | null> {
  // `previous: null` is a file that did not exist before
  // this save — `4-status.json`, the first time a spec's own tick or
  // Save lands after this feature ships. Every OTHER caller's files
  // already exist (a document tab reads them before it can be edited
  // at all), so this is new only for the state file's own sibling
  // entry.
  const paths = edits.map((edit) => {
    const path = join(dir, edit.file);
    return { edit, path, previous: existsSync(path) ? readFileSync(path, "utf-8") : null };
  });
  const rollback = (): void => {
    for (const { path, previous } of paths) {
      if (previous === null) unlinkSync(path);
      else writeFileSync(path, previous);
    }
  };
  for (const { edit, path } of paths) writeFileSync(path, asFileText(edit.text));

  for (const { edit } of paths) {
    const added = await run(dir, ["add", "--", edit.file]);
    if (added.code !== 0) {
      rollback();
      return edit.file;
    }
  }
  return null;
}

/** Push the save's commit. A push origin refuses is put on top of
 *  origin and pushed once more; whatever cannot be pushed is reset away
 *  to `before`, the commit the save started from. */
async function pushOrUndo(
  run: GitRunner,
  root: string,
  resolveBase: (root: string) => Promise<string | null>,
  says: { before: string; specLabel: string; subject: string },
): Promise<SpecsSaveResult> {
  const { before, specLabel, subject } = says;
  const pushed = await run(root, ["push", "-q", "origin", "HEAD"]);
  if (pushed.code === 0) return { ok: true, note: `saved ${subject}`, committed: true };
  console.error(`Save push refused for ${specLabel}, ${subject}: ${firstGitLine(pushed.stderr)}`);
  const base = await resolveBase(root);
  if (!base) {
    await run(root, ["reset", "--hard", before]);
    return notSaved(`${subject} was committed but the default branch could not be found — nothing was kept.`);
  }
  const fetched = await run(root, ["fetch", "--quiet", "origin", base]);
  if (fetched.code === 0) {
    const rebased = await rebaseAndRetry(run, root, base, says);
    if (rebased) return rebased;
  }
  await run(root, ["reset", "--hard", before]);
  return notSaved(failedHere(`${subject} was committed but the push to origin failed — nothing was kept.`));
}

/** Put the save's commit on top of the fetched `base` and push again.
 *  The answer when that settles it — saved, or not kept because of a
 *  rebase that failed — and `null` when the retried push was refused. */
async function rebaseAndRetry(
  run: GitRunner,
  root: string,
  base: string,
  says: { before: string; specLabel: string; subject: string },
): Promise<SpecsSaveResult | null> {
  const { before, specLabel, subject } = says;
  const rebased = await run(root, ["rebase", `refs/remotes/origin/${base}`]);
  if (rebased.code === 0) {
    const retried = await run(root, ["push", "-q", "origin", "HEAD"]);
    if (retried.code === 0) return { ok: true, note: `saved ${subject}`, committed: true };
    console.error(`Save push refused for ${specLabel}, ${subject}: ${firstGitLine(retried.stderr)}`);
    return null;
  }
  const unmerged = await run(root, ["diff", "--name-only", "--diff-filter=U"]);
  const conflicts = unmerged.code === 0 ? unmerged.stdout.split("\n").filter(Boolean) : [];
  await run(root, ["rebase", "--abort"]);
  await run(root, ["reset", "--hard", before]);
  if (conflicts.length > 0) {
    return notSaved(
      `${subject} conflicts with origin in ${conflictFiles(conflicts.slice(0, 5), conflicts.length - 5)} — nothing was kept.`,
    );
  }
  return notSaved(`${subject} could not be put on top of origin — nothing was kept.`);
}

/** One file, which is `saveSpecFiles` with one edit in it. Kept as its
 *  own name because two callers and two test suites say it, and because
 *  a save of one file is what most saves still are. */
export async function saveSpecFile(
  run: GitRunner,
  dir: string,
  resolveBase: (root: string) => Promise<string | null>,
  edit: { file: string; text: string; baseSha: string | null; specLabel: string; message: string },
): Promise<SpecsSaveResult> {
  return saveSpecFiles(run, dir, resolveBase, [{ file: edit.file, text: edit.text, baseSha: edit.baseSha }], edit);
}
