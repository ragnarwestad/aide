// Spec 291: read and write one file on a spec's own OPEN branch,
// without ever checking it out.
//
// `implement` never merges its own work — only `archive` does — so a
// finished `implement` step's real progress (ticked Phase-table rows) is
// committed only to `aide/<folder>` and stays invisible to `main` until
// `archive` succeeds. The Overview page's Checks section and its `/tick`
// route both used to read and write `4-status.md` off `main`'s copy in
// the shared machinery checkout — the wrong branch, and the reason
// `archive`'s own human-approval gate (every Acceptance-criteria row
// ticked) could not be reached for real, already-done work.
//
// The read side is the fetch idiom `BranchStatusChecker.isMerged()`
// already uses (`fetch --quiet origin <branch>`) plus `git show
// <ref>:<path>` — no working tree touched. The write side builds a new
// commit with plumbing that only touches the object database: a real
// scratch temp file for `hash-object` (not `--stdin` — `GitRunner` has
// no stdin channel, and a temp file needs none), a temporary index
// (`GIT_INDEX_FILE`, via the widened `GitRunner`'s `env` parameter) so
// the shared checkout's own index never moves, and a non-force push —
// which is what actually rejects a race against a headless run's own
// commit to the same branch (git enforces fast-forward server-side).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import type { BranchStatusChecker, GitRunner } from "./branch-status.ts";
import { specBranch } from "./branch-status.ts";

export interface BranchFileRead {
  text: string;
  /** The commit that last touched THIS path on the branch — the same
   *  "which version" a `baseSha` names everywhere else on this page
   *  (`lastCommitOf`'s shape), not the branch tip. */
  sha: string;
}

/** `4-status.md`'s content at the tip of `refs/heads/<branch>` on
 *  origin, or `null` when the branch is gone or has never had the path.
 *  `root` is a git working tree (any one — nothing here reads or
 *  writes ITS files), and nothing here checks anything out. */
export async function readStatusFromBranch(
  run: GitRunner,
  root: string,
  branch: string,
  relPath: string,
): Promise<BranchFileRead | null> {
  const fetched = await run(root, ["fetch", "--quiet", "origin", branch]);
  if (fetched.code !== 0) return null;
  const ref = `refs/remotes/origin/${branch}`;
  const commit = await run(root, ["log", "-1", "--format=%H", ref, "--", relPath]);
  const sha = commit.code === 0 ? commit.stdout.trim() : "";
  if (!sha) return null;
  const shown = await run(root, ["show", `${ref}:${relPath}`]);
  return shown.code === 0 ? { text: shown.stdout, sha } : null;
}

export interface BranchWriteResult {
  ok: boolean;
  /** One sentence for the reader, the same shape `SpecsSaveResult.note` is. */
  note: string;
}

const refuse = (note: string): BranchWriteResult => ({ ok: false, note });

/** Commit `text` at `relPath` straight onto `refs/heads/<branch>` at
 *  origin — never checking the branch out, never moving `root`'s own
 *  `HEAD` or index.
 *
 *  `expectedBaseSha` is the same row-level guard `saveSpecFiles` already
 *  makes for `main`: the FILE's last-touch commit on the branch, read
 *  fresh right here, must still be what the page was drawn from — a
 *  mismatch refuses before anything is written. A concurrent write that
 *  landed AFTER this fetch (the race REQ-4b names) is instead caught by
 *  the push itself: it is explicitly non-force, and git rejects it
 *  server-side the moment the branch has moved past the parent this
 *  commit was built on. */
export async function writeStatusToBranch(
  run: GitRunner,
  root: string,
  branch: string,
  relPath: string,
  text: string,
  expectedBaseSha: string | null,
  message: string,
): Promise<BranchWriteResult> {
  const fileName = relPath.split("/").pop() ?? relPath;
  let scratchDir: string | null = null;
  try {
    const fetched = await run(root, ["fetch", "--quiet", "origin", branch]);
    if (fetched.code !== 0) return refuse(`origin could not be reached — nothing was saved`);

    const ref = `refs/remotes/origin/${branch}`;
    const tipOut = await run(root, ["rev-parse", ref]);
    const tip = tipOut.code === 0 ? tipOut.stdout.trim() : "";
    if (!tip) return refuse(`${branch} is no longer on origin — nothing was saved`);

    const currentOut = await run(root, ["log", "-1", "--format=%H", ref, "--", relPath]);
    const currentSha = currentOut.code === 0 ? currentOut.stdout.trim() : "";
    if ((currentSha || null) !== expectedBaseSha) {
      return refuse(`${fileName} has changed since you opened it — nothing was saved, open it again`);
    }

    const tipTreeOut = await run(root, ["rev-parse", `${tip}^{tree}`]);
    if (tipTreeOut.code !== 0) return refuse(`${branch}'s tree could not be read — nothing was saved`);
    const tipTree = tipTreeOut.stdout.trim();

    scratchDir = mkdtempSync(join(tmpdir(), "aide-branch-write-"));
    const blobPath = join(scratchDir, "content");
    writeFileSync(blobPath, text);
    const blobOut = await run(root, ["hash-object", "-w", "--", blobPath]);
    if (blobOut.code !== 0) return refuse(`${fileName} could not be written — nothing was saved`);
    const blobSha = blobOut.stdout.trim();

    const indexPath = join(scratchDir, "index");
    const env = { GIT_INDEX_FILE: indexPath };
    const readTree = await run(root, ["read-tree", tipTree], undefined, env);
    if (readTree.code !== 0) return refuse(`${fileName} could not be written — nothing was saved`);
    const updateIndex = await run(
      root,
      ["update-index", "--cacheinfo", `100644,${blobSha},${relPath}`],
      undefined,
      env,
    );
    if (updateIndex.code !== 0) return refuse(`${fileName} could not be written — nothing was saved`);
    const writeTreeOut = await run(root, ["write-tree"], undefined, env);
    if (writeTreeOut.code !== 0) return refuse(`${fileName} could not be written — nothing was saved`);
    const newTree = writeTreeOut.stdout.trim();

    const commitTreeOut = await run(root, ["commit-tree", newTree, "-p", tip, "-m", message]);
    if (commitTreeOut.code !== 0) return refuse(`${fileName} could not be committed — nothing was saved`);
    const newCommit = commitTreeOut.stdout.trim();

    // Non-force: git refuses this the moment `refs/heads/<branch>` on
    // origin is no longer `tip` — the exact race a headless run's own
    // commit between our fetch and this push would create.
    const pushed = await run(root, ["push", "-q", "origin", `${newCommit}:refs/heads/${branch}`]);
    if (pushed.code !== 0) {
      return refuse(
        `${branch} changed on origin while this was being saved — nothing was saved, reload and try again`,
      );
    }

    return { ok: true, note: `saved ${fileName}` };
  } catch (err) {
    return refuse(`${fileName} could not be saved: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
  }
}

export interface OpenBranchTarget {
  root: string;
  branch: string;
  relPath: string;
  /** Where the same file sits once `archive` has run ON THE BRANCH: the
   *  step moves the folder to `archive/<folder>` and commits that there,
   *  so a branch whose archive has run but not landed answers nothing at
   *  all for `relPath` above while the default branch still carries the
   *  folder in its active place.
   *
   *  Offered rather than substituted, and READ paths only: a spec whose
   *  archive has run is not one a tick may write to, so `writeStatusToBranch`
   *  keeps asking for `relPath` and nothing else. */
  archivedRelPath: string;
}

/** Whether `specFolder` has an open `aide/<folder>` branch in the specs
 *  repo `dir` sits in, and — when it does — everything
 *  `readStatusFromBranch`/`writeStatusToBranch` need to act on `file`
 *  there. `null` when no such branch is open (REQ-2's untouched path).
 *
 *  REQ-6: reuses `ctx.branchStatus.openSpecBranches()`/`ctx.specsRoot()`
 *  — the same primitive `rootsStillHolding()` already calls — rather
 *  than introducing a new "is this branch open" check. One function
 *  rather than one copy per call site (the read path's cached call and
 *  the write path's `fresh` one) because the two are otherwise
 *  identical; `fresh` is the only thing that differs between them. */
export async function resolveOpenBranchTarget(
  ctx: { specsRoot: (dir: string) => Promise<string>; branchStatus: BranchStatusChecker },
  dir: string,
  specFolder: string,
  file: string,
  fresh: boolean,
): Promise<OpenBranchTarget | null> {
  const root = await ctx.specsRoot(dir);
  const branch = specBranch(specFolder);
  const open = await ctx.branchStatus.openSpecBranches(root, fresh);
  if (!open?.has(branch)) return null;
  return {
    root,
    branch,
    relPath: relative(root, join(dir, file)),
    archivedRelPath: relative(root, join(dirname(dir), "archive", basename(dir), file)),
  };
}
