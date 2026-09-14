// Landing's own finalize step for a `create` job (spec 453): the folder
// exists only under its literal provisional key (`new-<8 hex>`) until
// this runs, inside the merge worktree, under the specs repo's own
// merge lock — the one place two landings for the same repo are
// already serialized by construction, which is what lets this run
// exactly once per repo at a time with no lock of its own to take.
//
// Calls `aide-create-spec --assign-number`, never re-derives the number
// or the slug here: the two shared shell functions
// (`aide_next_spec_number`, `aide_slug_from_title` in
// `_aide-spec-lib.sh`) stay the one place either rule is computed
// (spec 82's invariant).

import { join, relative } from "node:path";
import type { Sentence } from "../../i18n/message.ts";
import { runScript, scriptFor } from "./run-script.ts";
import { failingLines } from "./test-gate.ts";

export type FinalizeCreateResult =
  | { ok: true; specFolder: string }
  | { ok: false; error: Sentence; detail?: string };

/** `work` is the merge worktree of the SPECS repo; `specsRootAbs` is the
 *  absolute path, in the ORIGINAL checkout, to where spec folders live
 *  (`ctx.machinerySpecsRoot(job.project)`) — possibly a subdirectory of
 *  the repo, never a different repo, since a `create` job's own repos
 *  are the specs repo alone. The relative offset between the two is
 *  fixed for the life of one repo root and is joined onto `work` fresh
 *  on every call, since `work` itself is a new worktree on every retry. */
export async function assignSpecNumberAfterMerge(
  work: string,
  repoRoot: string,
  specsRootAbs: string,
  provisionalFolder: string,
  opts: { scriptDir?: string } = {},
): Promise<FinalizeCreateResult> {
  const rel = relative(repoRoot, specsRootAbs);
  const specsRootInWork = rel && !rel.startsWith("..") ? join(work, rel) : work;
  // The runner's own directory first (`--runner-bin`), never PATH alone:
  // see `scriptFor`.
  const script = scriptFor("aide-create-spec", { beside: opts.scriptDir, override: process.env.AIDE_CREATE_SPEC_BIN });
  const result = await runScript(
    [script, "--specs-root", specsRootInWork, "--assign-number", "--folder", provisionalFolder],
    work,
    30_000,
  );
  let parsed: { ok?: boolean; specFolder?: string; error?: string } = {};
  try {
    parsed = JSON.parse(result.stdout.trim().split("\n").pop() || "{}");
  } catch {
    return {
      ok: false,
      error: { key: "landing.createAssignNumberFailed" },
      detail: `aide-create-spec --assign-number produced no readable answer — ${failingLines(result.stdout, result.stderr)}`,
    };
  }
  if (!parsed.ok || !parsed.specFolder) {
    return {
      ok: false,
      error: { key: "landing.createAssignNumberFailed" },
      detail: parsed.error ?? failingLines(result.stdout, result.stderr),
    };
  }
  return { ok: true, specFolder: parsed.specFolder };
}
