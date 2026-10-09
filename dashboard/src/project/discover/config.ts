// A project's own `.aide/config` and `.aide/project.yaml`: where its
// specs live, its worktree links, its code-landing policy and how strictly
// its acceptance criteria are checked.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest, type PreviewFrom } from "../parse-manifest.ts";

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

/** Which file a project's worktree links came out of. `null` when the
 *  manifest names none — `.aide/config`'s older `AIDE_WORKTREE_LINKS` is
 *  legacy and is never read (spec 549). */
export type WorktreeLinksSource = "project.yaml";

/** The gitignored paths a run must symlink into its worktree, and where
 *  they were read from (spec 184; manifest-only since spec 549).
 *
 *  `.aide/project.yaml` alone: it is COMMITTED, so a checkout that has
 *  never been configured on this machine still knows what its own
 *  commands need. A worktree link is a fact about the project itself, so
 *  a per-machine override in `.aide/config` has no place to win from.
 *
 *  This is one half of a hand-kept pair: `core/scripts/aide-run-spec`
 *  resolves the same file with one anchored `sed`, and a divergence here
 *  would report a project as unconfigured that a run links perfectly
 *  well, or the reverse. `core/tests/fixtures/worktree-links-precedence.json`
 *  is the table both sides are checked against. */
export function resolveWorktreeLinks(
  projectDir: string,
  manifestFile: string = join(projectDir, ".aide", "project.yaml"),
): { links: string; source: WorktreeLinksSource | null } {
  if (existsSync(manifestFile)) {
    const parsed = parseManifest(readFileSync(manifestFile, "utf-8"));
    const fromManifest = parsed.ok ? (parsed.data.worktreeLinks ?? "").trim() : "";
    if (fromManifest) return { links: fromManifest, source: "project.yaml" };
  }
  return { links: "", source: null };
}

/** What a project does with its archived CODE: merge it into the default
 *  branch, or leave it on its branch for a pull request. */
export type CodeLanding = "merge" | "pr";

/** Which of the two this project chose (spec 220).
 *
 *  The COMMITTED manifest and nothing else; like `resolveWorktreeLinks`
 *  above, it never reads `.aide/config`, so a gitignored file on one
 *  machine cannot overrule the policy the repo states.
 *
 *  Absent, unrecognized, unparseable or no manifest at all → `merge`,
 *  which is what every project on the host did before this existed.
 *
 *  One half of a hand-kept pair: `core/scripts/aide-run-spec` reads the
 *  same key with one anchored `sed` to default its own `--push`, and
 *  `core/tests/fixtures/code-landing-precedence.json` is the table both sides
 *  are checked against. */
export function resolveCodeLanding(projectDir: string): CodeLanding {
  const manifestFile = join(projectDir, ".aide", "project.yaml");
  if (!existsSync(manifestFile)) return "merge";
  const parsed = parseManifest(readFileSync(manifestFile, "utf-8"));
  return (parsed.ok ? parsed.data.codeLanding : undefined) ?? "merge";
}

/** How one branch of this project can be tried before it is merged,
 *  from the COMMITTED manifest's `deployment.previewFrom` and nothing
 *  else. `undefined` for no manifest, no key or a word it does not know,
 *  which reads as `none`. */
export function resolvePreviewFrom(projectDir: string): PreviewFrom | undefined {
  const manifestFile = join(projectDir, ".aide", "project.yaml");
  if (!existsSync(manifestFile)) return undefined;
  const parsed = parseManifest(readFileSync(manifestFile, "utf-8"));
  return parsed.ok ? parsed.data.deployment?.previewFrom : undefined;
}

/** Which file an install/test/preview command came out of. */
export type ConfigOverrideSource = ".aide/config" | "project.yaml";

/** What installing this project means on this machine, and where that
 *  answer came from (spec 345). `.aide/config`'s `AIDE_INSTALL_CMD`
 *  alone (spec 549) — a manifest `installCmd:` is never read, since an
 *  install command legitimately differs per machine (a PATH prefix a
 *  shell needs, say).
 *
 *  One half of a hand-kept pair: `core/scripts/_aide-spec-lib.sh`'s
 *  `aide_resolve_override` resolves the same file, and
 *  `core/tests/fixtures/config-cmd-precedence.json` is the table both sides
 *  are checked against. */
export function resolveInstallCmd(projectDir: string): { value: string | null; source: ".aide/config" | null } {
  const value = configValue(projectDir, "AIDE_INSTALL_CMD");
  return value ? { value, source: ".aide/config" } : { value: null, source: null };
}

/** This project's own test command: the manifest's `AIDE_TEST_CMD:` and
 *  nothing else, as `aide-resolve-test-cmd` reads it. */
export function resolveTestCmd(
  projectDir: string,
): { value: string | null; source: ConfigOverrideSource | null } {
  const manifestFile = join(projectDir, ".aide", "project.yaml");
  if (!existsSync(manifestFile)) return { value: null, source: null };
  const parsed = parseManifest(readFileSync(manifestFile, "utf-8"));
  const value = parsed.ok ? (parsed.data.AIDE_TEST_CMD ?? "").trim() : "";
  return value ? { value, source: "project.yaml" } : { value: null, source: null };
}

/** How this project is started for a look at one branch, and where that
 *  came from — the manifest's `previewCmd:` alone (spec 549), the same
 *  shape as `resolveTestCmd`: a legacy `AIDE_PREVIEW_CMD` in
 *  `.aide/config` is never read. */
export function resolvePreviewCmd(projectDir: string): { value: string | null; source: "project.yaml" | null } {
  const manifestFile = join(projectDir, ".aide", "project.yaml");
  if (!existsSync(manifestFile)) return { value: null, source: null };
  const parsed = parseManifest(readFileSync(manifestFile, "utf-8"));
  const value = parsed.ok ? (parsed.data.previewCmd ?? "").trim() : "";
  return value ? { value, source: "project.yaml" } : { value: null, source: null };
}

/** What the project says it is, in one line: the manifest's `description:`
 *  alone, in the same shape as `resolvePreviewCmd`. */
export function resolveDescription(projectDir: string): { value: string | null; source: "project.yaml" | null } {
  const manifestFile = join(projectDir, ".aide", "project.yaml");
  if (!existsSync(manifestFile)) return { value: null, source: null };
  const parsed = parseManifest(readFileSync(manifestFile, "utf-8"));
  const value = parsed.ok ? (parsed.data.description ?? "").trim() : "";
  return value ? { value, source: "project.yaml" } : { value: null, source: null };
}
