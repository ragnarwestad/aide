// A project's own `.aide/config` and `.aide/project.yaml`: where its
// specs live, its worktree links, its code-landing policy and its
// schedule.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest, type ManifestData, type ScheduleEntry } from "../parse-manifest.ts";

/** One key out of a project's OWN `.aide/config` — the personal,
 *  gitignored file where an operator writes what only their machine
 *  knows: where the specs live, and what installing this project means
 *  here. Plain `KEY=value` lines, as the file has always been; a key
 *  that is absent or empty is `null`, never a guess. */
export function configValue(projectDir: string, key: string): string | null {
  const cfg = join(projectDir, ".aide", "config");
  if (!existsSync(cfg)) return null;
  for (const line of readFileSync(cfg, "utf-8").split("\n")) {
    // The name is matched as written, not trimmed: an indented line and
    // a commented-out one were both ignored before this was generalised,
    // and a config reader that quietly starts accepting more is a change
    // nobody asked for.
    const [name, ...rest] = line.split("=");
    if (name !== key) continue;
    const value = rest.join("=").trim();
    if (value) return value;
  }
  return null;
}

export const configSpecsPath = (projectDir: string): string | null => configValue(projectDir, "AIDE_SPECS_PATH");

/** Which of the two files a project's worktree links came out of.
 *  `null` when neither names any. */
export type WorktreeLinksSource = "project.yaml" | ".aide/config";

/** The gitignored paths a run must symlink into its worktree, and where
 *  they were read from (spec 184).
 *
 *  `.aide/project.yaml` first: it is COMMITTED, so a checkout that has
 *  never been configured on this machine still knows what its own
 *  commands need. `.aide/config`'s older `AIDE_WORKTREE_LINKS` is the
 *  fallback, so a project migrated on one machine keeps running on the
 *  others while both spellings exist.
 *
 *  This is one half of a hand-kept pair: `core/scripts/aide-run-spec`
 *  resolves the same two files in the same order with one anchored
 *  `sed`, and a divergence here would report a project as unconfigured
 *  that a run links perfectly well, or the reverse.
 *  `tests/fixtures/worktree-links-precedence.json` is the table both
 *  sides are checked against. */
export function resolveWorktreeLinks(
  projectDir: string,
): { links: string; source: WorktreeLinksSource | null } {
  const manifestFile = join(projectDir, ".aide", "project.yaml");
  if (existsSync(manifestFile)) {
    const parsed = parseManifest(readFileSync(manifestFile, "utf-8"));
    const fromManifest = parsed.ok ? (parsed.data.worktreeLinks ?? "").trim() : "";
    if (fromManifest) return { links: fromManifest, source: "project.yaml" };
  }
  const fromConfig = configValue(projectDir, "AIDE_WORKTREE_LINKS");
  if (fromConfig) return { links: fromConfig, source: ".aide/config" };
  return { links: "", source: null };
}

/** What a project does with its archived CODE: merge it into the default
 *  branch, or leave it on its branch for a pull request. */
export type CodeLanding = "merge" | "pr";

/** Which of the two this project chose (spec 220).
 *
 *  The COMMITTED manifest and nothing else — deliberately unlike
 *  `resolveWorktreeLinks` above, which reads `.aide/config` as a
 *  fallback. That fallback exists because `AIDE_WORKTREE_LINKS` predates
 *  the manifest and both spellings had to keep working; this key has no
 *  older spelling to migrate from, and giving it one would let a
 *  gitignored file on one machine quietly overrule the policy the repo
 *  states.
 *
 *  Absent, unrecognized, unparseable or no manifest at all → `merge`,
 *  which is what every project on the host did before this existed.
 *
 *  One half of a hand-kept pair: `core/scripts/aide-run-spec` reads the
 *  same key with one anchored `sed` to default its own `--push`, and
 *  `tests/fixtures/code-landing-precedence.json` is the table both sides
 *  are checked against. */
export function resolveCodeLanding(projectDir: string): CodeLanding {
  const manifestFile = join(projectDir, ".aide", "project.yaml");
  if (!existsSync(manifestFile)) return "merge";
  const parsed = parseManifest(readFileSync(manifestFile, "utf-8"));
  return (parsed.ok ? parsed.data.codeLanding : undefined) ?? "merge";
}

/** Which of the two files an install/test command came out of. Unlike
 *  `WorktreeLinksSource`, `.aide/config` is the PRIMARY source here, not
 *  the fallback — see `resolveInstallCmd`/`resolveTestCmd` below. */
export type ConfigOverrideSource = ".aide/config" | "project.yaml";

/** Resolve a key that may be set in either file, `.aide/config` winning
 *  (spec 345) — the reverse of `resolveWorktreeLinks`'s manifest-wins
 *  precedence, because an install/test command legitimately differs per
 *  machine (a PATH prefix a shell needs, say) while a worktree link is a
 *  fact about the project itself and cannot. `null` when neither file
 *  sets the key. */
function resolveOverride(
  projectDir: string,
  configKey: string,
  manifestValue: (data: ManifestData) => string | undefined,
): { value: string | null; source: ConfigOverrideSource | null } {
  const fromConfig = configValue(projectDir, configKey);
  if (fromConfig) return { value: fromConfig, source: ".aide/config" };
  const manifestFile = join(projectDir, ".aide", "project.yaml");
  if (existsSync(manifestFile)) {
    const parsed = parseManifest(readFileSync(manifestFile, "utf-8"));
    const fromManifest = parsed.ok ? (manifestValue(parsed.data) ?? "").trim() : "";
    if (fromManifest) return { value: fromManifest, source: "project.yaml" };
  }
  return { value: null, source: null };
}

/** What installing this project means on this machine, and where that
 *  answer came from (spec 345). `.aide/config`'s `AIDE_INSTALL_CMD`
 *  first, the manifest's `installCmd:` as the fallback — see
 *  `resolveOverride` above for why the precedence is reversed from
 *  `resolveWorktreeLinks`.
 *
 *  One half of a hand-kept pair: `core/scripts/_aide-spec-lib.sh`'s
 *  `aide_resolve_override` resolves the same two files in the same
 *  order, and `tests/fixtures/config-cmd-precedence.json` is the table
 *  both sides are checked against. */
export function resolveInstallCmd(
  projectDir: string,
): { value: string | null; source: ConfigOverrideSource | null } {
  return resolveOverride(projectDir, "AIDE_INSTALL_CMD", (d) => d.installCmd);
}

/** This project's own test command, and where it came from (spec 345) —
 *  the same config-wins precedence as `resolveInstallCmd`. Callers that
 *  also want a LOCKFILE-derived fallback (nothing in either file) use
 *  `detect-commands.ts`'s `detectProjectCommands()` once this answers
 *  `null`; this function never guesses one itself. */
export function resolveTestCmd(
  projectDir: string,
): { value: string | null; source: ConfigOverrideSource | null } {
  return resolveOverride(projectDir, "AIDE_TEST_CMD", (d) => d.testCmd);
}

/** This project's own recurring jobs (spec 259), read fresh off the
 *  MACHINERY's checkout — the same root `resolveCodeLanding` reads,
 *  never the dashboard's read-only display clone, and never cached: the
 *  poll that acts on this wants the config a run would actually see,
 *  not a copy that can go stale between a Save and the next tick.
 *
 *  The committed manifest and nothing else, for the same reason
 *  `codeLanding` has no `.aide/config` fallback: a schedule is a team
 *  policy, and a gitignored file on one machine cannot state one.
 *  Absent, unparseable, or no manifest at all → an empty list, which
 *  reads the same as "this project has no schedule" everywhere else
 *  does. */
export function resolveSchedule(projectDir: string): ScheduleEntry[] {
  const manifestFile = join(projectDir, ".aide", "project.yaml");
  if (!existsSync(manifestFile)) return [];
  const parsed = parseManifest(readFileSync(manifestFile, "utf-8"));
  return parsed.ok ? (parsed.data.schedule ?? []) : [];
}
