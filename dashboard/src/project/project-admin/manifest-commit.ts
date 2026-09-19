// A Settings save's manifest keys, committed and pushed in the
// dashboard's own checkout the moment they are saved.
//
// Written to disk and left there, they sat uncommitted in the checkout
// every run and every tick pulls into — and a pull refuses a dirty
// checkout, so the next tick on any spec of that project was refused
// ("the specs checkout has uncommitted changes") until someone
// committed them by hand.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lastCommitOf } from "../../git/description-freshness.ts";
import { pullFastForward, saveSpecFile } from "../../git/specs-pull.ts";
import { manifestWithScalar } from "./manifest-io.ts";
import type { GitRunner } from "../../git/branch-status.ts";

const MANIFEST_FILE = ".aide/project.yaml";

/** What a manifest commit needs from git: how to run a command, and how
 *  to resolve a checkout's default branch. */
export interface ScheduleGit {
  run: GitRunner;
  resolveBase: (root: string) => Promise<string | null>;
}

/** Apply `edits` to the manifest in `codeRoot` and commit and push the
 *  result, or say why not. Nothing to change is a success with nothing
 *  committed. The caller holds `mergeLock` on `codeRoot`. */
export async function commitManifestEdits(
  git: ScheduleGit,
  codeRoot: string,
  edits: { key: string; value: string }[],
): Promise<{ ok: boolean; note?: string }> {
  // Brought up to origin FIRST: the edit is worked out against the
  // manifest as it stands there, never a copy that fell behind — worked
  // out against a stale one, a save found "nothing to change" and
  // committed nothing, or rewrote a line someone else had just moved.
  const pulled = await pullFastForward(git.run, codeRoot, git.resolveBase);
  if (!pulled.ok) return { ok: false, note: pulled.note };
  const path = join(codeRoot, MANIFEST_FILE);
  const before = existsSync(path) ? readFileSync(path, "utf-8") : "";
  let text = before;
  try {
    for (const edit of edits) text = manifestWithScalar(text, edit.key, edit.value, MANIFEST_FILE);
  } catch (err) {
    return { ok: false, note: err instanceof Error ? err.message : String(err) };
  }
  if (text === before) return { ok: true };
  const current = await lastCommitOf(git.run, codeRoot, MANIFEST_FILE);
  const saved = await saveSpecFile(git.run, codeRoot, git.resolveBase, {
    file: MANIFEST_FILE,
    text,
    baseSha: current?.sha ?? null,
    specLabel: "settings",
    message: `Set ${edits.map((e) => e.key).join(", ")} from the dashboard`,
  });
  return saved.ok ? { ok: true } : { ok: false, note: saved.note };
}
