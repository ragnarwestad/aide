// The dashboard's own settings file for a project whose manifest is not
// tracked, and the question that decides which of the two files a save
// goes to.
//
// A project keeps nothing of Aide's in its repository: what the person
// sets in the dashboard lives beside the checkouts, in the manifest's own
// format, and reaches a run as a copy (`git/checkout-manifest.ts`). A
// manifest the team tracks is theirs and is never written here.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { GitRunner } from "../../git/branch-status.ts";
import { manifestWithScalar } from "./manifest-io.ts";

/** Whether `.aide/project.yaml` is tracked in the checkout `dir`.
 *
 *  Only `git ls-files --error-unmatch` decides it: exit 0 is tracked,
 *  exit 1 is not. Any other answer is git being unable to say, and then
 *  nothing is written, committed or overwritten for a manifest key —
 *  `why` carries git's own words for the step that has to refuse. */
export async function manifestTracked(
  run: GitRunner,
  dir: string,
): Promise<{ tracked: boolean | null; why?: string }> {
  const res = await run(dir, ["ls-files", "--error-unmatch", "--", ".aide/project.yaml"]);
  if (res.code === 0) return { tracked: true };
  if (res.code === 1) return { tracked: false };
  const said = (res.stderr ?? "").trim() || (res.stdout ?? "").trim();
  return { tracked: null, why: `git could not say whether .aide/project.yaml is tracked (exit ${res.code})${said ? `: ${said}` : ""}` };
}

/** Where a project's settings are kept, for the page to say so (spec 512):
 *  in the project's own tracked manifest (`project`), in the dashboard's
 *  settings file (`dashboard`), in both — the tracked one wins and the
 *  dashboard's copy is not used (`shadowed`) — or nowhere yet (`none`).
 *  A git that cannot say counts as not tracked. */
export type SettingsHome = "project" | "dashboard" | "shadowed" | "none";

export function settingsHome(tracked: boolean | null, settingsFileExists: boolean): SettingsHome {
  if (tracked) return settingsFileExists ? "shadowed" : "project";
  return settingsFileExists ? "dashboard" : "none";
}

/** Write `text` to `file` through a temporary file and one `rename`, so a
 *  reader never sees half of it. */
export function writeAtomically(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** What a settings file starts from: itself, else the first of `seeds`
 *  that exists (an untracked manifest an earlier Add or `/aide-manifest`
 *  left behind — its content is never lost), else `fallbackText`. */
export function settingsText(file: string, seeds: string[], fallbackText = ""): string {
  const source = [file, ...seeds].find((p) => existsSync(p));
  return source ? readFileSync(source, "utf-8") : fallbackText;
}

/** Make sure the settings file exists, seeded as `settingsText` says.
 *  An existing file is left exactly as it is. */
export function seedSettingsFile(file: string, seeds: string[], fallbackText = ""): void {
  if (existsSync(file)) return;
  const text = settingsText(file, seeds, fallbackText);
  if (text) writeAtomically(file, text);
}

/** Apply scalar `edits` to the settings file, touching only those lines
 *  (`manifestWithScalar`). Throws when a key is list-shaped, as the
 *  manifest editor does. */
export function applySettingsEdits(
  file: string,
  edits: { key: string; value: string }[],
  seeds: string[],
  fallbackText = "",
): void {
  const before = settingsText(file, seeds, fallbackText);
  let text = before;
  for (const edit of edits) text = manifestWithScalar(text, edit.key, edit.value, file);
  if (text !== before || !existsSync(file)) writeAtomically(file, text);
}
