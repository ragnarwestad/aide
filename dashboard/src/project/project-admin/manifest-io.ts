// Naming a project, and writing the files that describe it: the
// manifest, the personal `.aide/config`, and the worktree-links rule
// both readers refuse the same value by.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { stringify } from "yaml";

/** A directory name, and nothing that could be read as a path. No
 *  separator, no `..`, no leading dot (a project directory the scan
 *  would find but nobody would see), and nothing that needs quoting on
 *  a command line. Deliberately narrower than "what a filesystem
 *  allows": every name that gets past this is one `discoverProjects`
 *  will list under its own basename. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Why this name cannot be a project, or `null`. Exported because the
 *  server validates the same way on both routes and a second copy of
 *  the rule would eventually disagree with this one. */
export function projectNameError(name: unknown): string | null {
  if (typeof name !== "string" || name.trim() === "") return "a project name is required";
  if (name.includes("..")) return `"${name}" is not a usable project name: it would leave the projects root`;
  if (!NAME_RE.test(name)) {
    return (
      `"${name}" is not a usable project name: letters, digits, dot, dash and ` +
      `underscore only, and it may not start with a dot`
    );
  }
  return null;
}


/** The manifest the Add flow writes when a checkout has none: `name`
 *  and `description`, which is the smallest manifest that renders
 *  USEFULLY rather than the smallest that avoids an error
 *  (`render/projects-page.ts` shows a description and nothing else without one).
 *  Everything past those two is `/aide-manifest`'s job, and the form
 *  says so. Serialized by the same `yaml` package that reads it back,
 *  so nobody here has to get quoting right on a description's behalf. */
export function minimalManifest(name: string, description?: string): string {
  return stringify({ name, ...(description ? { description } : {}) });
}

/** Set (or clear) ONE top-level scalar in a `.aide/project.yaml`,
 *  touching nothing else in the file (spec 184).
 *
 *  The same discipline `writeAideConfig` applies to `.aide/config`, and
 *  for a sharper reason: a manifest is a file a person wrote through
 *  `/aide-manifest`, with comments, key order and multi-line blocks that
 *  a parse-mutate-`stringify()` round trip promises nothing about. Only
 *  the one anchored line is ever touched.
 *
 *  The line is written PLAIN and unquoted, because the reader on the
 *  other side is one anchored `sed` in `aide-run-spec` and not a YAML
 *  parser — a quoted value would read back there as empty, which is
 *  indistinguishable from "no links configured".
 *
 *  An empty value REMOVES the key: a manifest carrying `worktreeLinks:`
 *  with nothing after it says something no reader agrees about.
 *
 *  Throws when the key is already list-shaped. Replacing the first line
 *  of a list leaves its `- ` children orphaned under whatever key came
 *  before — invalid YAML, written silently — and nothing in this
 *  codebase writes that shape, so it is a file somebody hand-edited and
 *  a guess is the wrong answer to it. */
export function upsertManifestScalar(file: string, key: string, value: string): void {
  const text = existsSync(file) ? readFileSync(file, "utf-8") : "";
  const next = manifestWithScalar(text, key, value, file);
  if (next === text) return; // nothing to clear, and nothing to write
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, next);
}

/** The same edit on the manifest's TEXT, for a caller that commits the
 *  result itself rather than leaving it on disk (Settings, through
 *  `saveSpecFile`). `label` names the file in the one refusal. */
export function manifestWithScalar(text: string, key: string, value: string, label: string): string {
  const lines = text.split("\n");
  // A trailing newline splits into a final empty element; it is put back
  // by the join, so the file's shape survives a no-op.
  const trailing = lines.length && lines[lines.length - 1] === "" ? lines.pop() : undefined;
  const at = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (at !== -1) {
    const next = lines[at + 1];
    if (next !== undefined && /^\s+-\s/.test(next)) {
      throw new Error(
        `${key} in ${label} is a YAML list, and this writes a single line — edit it by hand or make it a scalar first`,
      );
    }
    if (value) lines[at] = `${key}: ${value}`;
    else lines.splice(at, 1);
  } else if (value) {
    // Appended at the end rather than slotted in: a manifest's key order
    // is its author's, and there is no position here that is more
    // correct than the one after everything they wrote.
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(`${key}: ${value}`);
  } else {
    return text; // nothing to clear, and nothing to write
  }
  return lines.join("\n") + (trailing !== undefined || lines.length ? "\n" : "");
}

/** Keys into the project's own `.aide/config`, in the plain `KEY=value`
 *  form every reader expects (`discover.ts`'s `configValue` and the
 *  shell's `aide_specs_root` and `aide_config_get`). The file is
 *  personal and may already carry other keys — `AIDE_INSTALL_CMD` — and
 *  comments, so it is rewritten line by line with only the named keys
 *  replaced. Two lines for one key is a file whose meaning depends on
 *  which reader you ask.
 *
 *  One writer for every key rather than one per key (spec 138): the
 *  specs root and the worktree links land in the same file, and a
 *  second copy of this rule would eventually preserve a comment the
 *  first one dropped. */
export function writeAideConfig(projectDir: string, values: Record<string, string>): void {
  const dir = join(projectDir, ".aide");
  const file = join(dir, "config");
  const keys = Object.keys(values);
  const kept = existsSync(file)
    ? readFileSync(file, "utf-8")
        .split("\n")
        .filter((line) => !keys.includes(line.split("=")[0]!))
    : [];
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  for (const key of keys) kept.push(`${key}=${values[key]}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${kept.join("\n")}\n`);
}

/** Directory names a build WRITES into, or that a tool locks a cache in
 *  — never a dependency cache a build only reads (spec 186). A link is
 *  one symlink into the main checkout that every concurrent run shares,
 *  so two runs building through it overwrite each other's output, and a
 *  tool that locks its own cache directory blocks or corrupts it. Kept
 *  as a plain array for the same reason WORKFLOW_STEPS and
 *  DEPENDENCY_GATED_STEPS are: `aide-run-spec` holds a second copy
 *  (WORKTREE_LINK_DENYLIST, a bash string) with no shared source
 *  between them, and
 *  test_the_two_copies_of_the_worktree_link_denylist_agree pins the two. */
export const WORKTREE_LINK_DENYLIST = ["build", "target", "dist", ".gradle"] as const;

/** Why this worktree-links value cannot be used, or `null`.
 *
 *  The same rule `aide-run-spec` refuses on, in the same words: a
 *  worktree carries TRACKED files only, so each entry is a path
 *  RELATIVE to the repository root that the run symlinks in from the
 *  main checkout. An absolute path or one containing `..` names
 *  something outside the repo, which the run refuses by name rather
 *  than link. Exported because the readiness check and the write path
 *  ask the same question.
 *
 *  `key` names the SETTING the value came out of, because there are two
 *  spellings of it since spec 184 and a refusal is read as an
 *  instruction to go and edit one of them. Defaults to the manifest's,
 *  which is where everything this dashboard writes goes; the readiness
 *  check passes `AIDE_WORKTREE_LINKS` when it read the legacy file. The
 *  runner does exactly the same, with the same two strings. */
export function worktreeLinksError(value: string, key = "worktreeLinks"): string | null {
  for (const entry of value.split(/\s+/).filter(Boolean)) {
    if (entry.startsWith("/")) {
      return `${key} must name repo-relative paths: ${entry}`;
    }
    if (entry.includes("..")) {
      return `${key} must not escape the root: ${entry}`;
    }
    // The BASENAME, so a nested module's output (`backend/build`) is the
    // same answer as a top-level one — and asked before existence, since
    // a denied directory usually does exist: anyone who has run the
    // build locally has one.
    if ((WORKTREE_LINK_DENYLIST as readonly string[]).includes(entry.split("/").pop()!)) {
      return (
        `AIDE_WORKTREE_LINKS names a build output, not a dependency cache: ${entry} — ` +
        `such a directory is generated per worktree and wants no link at all`
      );
    }
  }
  return null;
}

/** Why a specs root cannot be used as typed, or `null` when it can. It
 *  has to be a full path. The server reads a relative one from its own
 *  working directory, which is the dashboard's own checkout: on
 *  2026-09-24 `aide-specs/claude-plattform` made a folder inside that
 *  checkout, and the project was set up to clone the dashboard's own
 *  repository as its specs. An empty value is not a path at all — it
 *  clears the setting — so it passes. */
export function specsPathError(value: string): string | null {
  if (!value || isAbsolute(value)) return null;
  return (
    `the specs path has to be a full path, starting with /: ${value} would be read from the dashboard's own folder, ` +
    "not from yours — write it out in full, for example /Users/<you>/develop/aide-specs/<project>"
  );
}
