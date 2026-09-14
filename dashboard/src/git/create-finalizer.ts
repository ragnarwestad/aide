import type { Sentence } from "../i18n/message.ts";
import type { GitRunner } from "./branch-status.ts";

/** Landing's own finalize step for a `create` job: renames the folder
 *  off its literal provisional key to its real `NN-slug` and rewrites
 *  its own `Task:` lines, run inside the merge worktree — `work`, the
 *  same argument `LandingGate` receives — right after the merge
 *  succeeds and before the push, so the rename lands in the same commit
 *  the merge is about to push. */
export type CreateFinalizer = (work: string) => Promise<
  { ok: true; specFolder: string } | { ok: false; error: Sentence; detail?: string }
>;

/** Runs the finalizer on one merge attempt, BEFORE the gate — recomputed
 *  on every attempt, since a `base` that moved between attempts means
 *  the folder count taken on a dropped attempt may already be stale.
 *  The rename becomes an ordinary part of the tree this attempt is
 *  about to push; a refusal behaves exactly like a merge conflict —
 *  the local merge is dropped and the branch is untouched. Returns the
 *  assigned folder, or the refusal to hand back as the attempt's result. */
export async function finalizeCreateOnAttempt(
  run: GitRunner,
  finalizeCreate: CreateFinalizer,
  where: { work: string; root: string; branch: string; base: string },
): Promise<{ specFolder: string } | { refused: { ok: false; root: string; error: Sentence; detail: string } }> {
  const finalized = await finalizeCreate(where.work);
  if (finalized.ok) return { specFolder: finalized.specFolder };
  await run(where.work, ["reset", "-q", "--hard", `origin/${where.base}`]);
  const at = `${where.branch} in ${where.root}`;
  return {
    refused: {
      ok: false,
      root: where.root,
      error: finalized.error,
      detail: finalized.detail ? `${finalized.detail}\n${at}` : at,
    },
  };
}
