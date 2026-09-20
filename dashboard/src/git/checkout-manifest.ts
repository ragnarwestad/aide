// What `ensureDashboardCheckout` does with the dashboard's own settings
// file: keep the derived manifest out of git, and write it into the clone.
//
// The dashboard's clone is a directory the dashboard made and nobody
// edits. It holds one derived copy of the settings the dashboard keeps for
// the project, as an ignored `.aide/project.yaml`, so that every reader of
// `<dir>/.aide/project.yaml` — in TypeScript and in bash — finds it. A
// manifest the team tracks always wins over the copy.

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { manifestTracked, seedSettingsFile, writeAtomically } from "../project/project-admin/settings-state.ts";
import type { GitRunner } from "./branch-status.ts";

const IGNORE_LINE = "/.aide/project.yaml";

/** List the derived manifest in the clone's own `.git/info/exclude`.
 *
 *  Before any fast-forward, never after: git refuses to overwrite an
 *  untracked file with a tracked one, but overwrites an ignored one — so
 *  the day the team commits a manifest, the pull goes through. Idempotent. */
export async function excludeDerivedManifest(run: GitRunner, code: string): Promise<void> {
  const res = await run(code, ["rev-parse", "--git-path", "info/exclude"]);
  if (res.code !== 0) return;
  const named = res.stdout.trim();
  if (!named) return;
  const file = isAbsolute(named) ? named : join(code, named);
  try {
    const text = existsSync(file) ? readFileSync(file, "utf-8") : "";
    if (text.split("\n").includes(IGNORE_LINE)) return;
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${text && !text.endsWith("\n") ? "\n" : ""}${IGNORE_LINE}\n`);
  } catch {
    /* a clone that cannot be written to is reported by the readiness check */
  }
}

/** Write the derived manifest into the clone from the settings file.
 *
 *  Tracked in the clone, or git unable to say: nothing is done. With no
 *  settings file yet, an untracked manifest in the person's checkout or
 *  in the clone seeds one first, so what a person drafted is not lost. */
export async function carryManifest(
  run: GitRunner,
  where: { code: string; personDir: string; settingsFile: string },
): Promise<void> {
  const { tracked } = await manifestTracked(run, where.code);
  if (tracked !== false) return;
  const manifest = join(where.code, ".aide", "project.yaml");
  try {
    seedSettingsFile(where.settingsFile, [join(where.personDir, ".aide", "project.yaml"), manifest]);
    if (!existsSync(where.settingsFile)) return;
    const wanted = readFileSync(where.settingsFile, "utf-8");
    if (existsSync(manifest) && readFileSync(manifest, "utf-8") === wanted) return;
    writeAtomically(manifest, wanted);
  } catch {
    /* the readiness check says what is missing */
  }
}
