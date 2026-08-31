// Naming a project, and writing the files that describe it: the
// manifest, the personal `.aide/config`, and the worktree-links rule
// both readers refuse the same value by.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { stringify } from "yaml";
import { parseManifest, type ScheduleEntry } from "../parse-manifest.ts";

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

/** What an add is actually AIMED at, once the Add form's picker is
 *  allowed to settle it (spec 131): the project's name, and the path of
 *  the checkout to register.
 *
 *  A bare `existingPath` — no separator — is what the picker sends:
 *  shorthand for the checkout of that name directly under the projects
 *  root, and the project's NAME, whatever was typed into Name beside it
 *  (spec 140). A project's name is its directory name and can be
 *  nothing else: `discoverProjects` reads it off the entry under the
 *  projects root and never out of a manifest, so a project registered
 *  under a differing typed name could never be discovered again.
 *  Typing `Skjer` for the directory `skjer` used to be refused, in a
 *  message naming `<root>/Skjer` — a path that does not exist either.
 *  A typed Name settles the name where there is nothing picked: the
 *  git-clone path, where it is the directory about to be made. A full
 *  path, typed by hand or posted straight at the route, is used exactly
 *  as before, mismatch refusal and all — that is not the picker.
 *
 *  Exported for the same reason `projectNameError` is: the route needs
 *  the DERIVED name — it is what goes on the allowlist — and a second
 *  copy of this rule in `serve.ts` would eventually disagree with this
 *  one. */
export function addProjectTarget(
  projectsRoot: string,
  req: { name: string; existingPath?: string },
): { name: string; existingPath?: string } {
  const raw = req.existingPath?.trim();
  const bare = raw && !raw.includes("/") ? raw : undefined;
  return {
    name: bare || req.name?.trim() || "",
    existingPath: raw ? (bare ? join(projectsRoot, bare) : raw) : undefined,
  };
}

/** The manifest the Add flow writes when a checkout has none: `name`
 *  and `description`, which is the smallest manifest that renders
 *  USEFULLY rather than the smallest that avoids an error
 *  (`render/site.ts` shows a description and nothing else without one).
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
  const lines = text.split("\n");
  // A trailing newline splits into a final empty element; it is put back
  // by the join, so the file's shape survives a no-op.
  const trailing = lines.length && lines[lines.length - 1] === "" ? lines.pop() : undefined;
  const at = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (at !== -1) {
    const next = lines[at + 1];
    if (next !== undefined && /^\s+-\s/.test(next)) {
      throw new Error(
        `${key} in ${file} is a YAML list, and this writes a single line — edit it by hand or make it a scalar first`,
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
    return; // nothing to clear, and nothing to write
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, lines.join("\n") + (trailing !== undefined || lines.length ? "\n" : ""));
}

/** One serialized `schedule:` list entry. `name`, `cron` and `prompt` are
 *  always double-quoted — a `cron` value commonly starts with `*`, which
 *  is a YAML alias marker unquoted — and `enabled` is written only when
 *  `false`, matching `ScheduleEntry.enabled`'s absent-means-true
 *  contract: an entry that is enabled by default never gains a line
 *  nobody asked for. */
function serializeScheduleEntry(entry: ScheduleEntry): string[] {
  const lines = [
    `  - name: "${entry.name}"`,
    `    cron: "${entry.cron}"`,
    `    prompt: "${entry.prompt}"`,
  ];
  if (entry.enabled === false) lines.push(`    enabled: false`);
  // Written only when the entry names one, matching `ScheduleEntry.model`'s
  // absent-means-the-configuration-decides contract: an entry left on the
  // default never gains a line pinning it to whatever that default
  // happened to be on the day it was saved.
  if (entry.model) lines.push(`    model: "${entry.model}"`);
  return lines;
}

/** Set the WHOLE `schedule:` list in a `.aide/project.yaml`, touching
 *  nothing else in the file (spec 276).
 *
 *  Block-span text surgery, exactly like `upsertManifestScalar`'s
 *  single-line surgery and for the same reason: a manifest carries a
 *  person's own comments and key order that a parse-mutate-`stringify()`
 *  round trip does not promise to preserve. The whole `schedule:` key and
 *  every following line indented under it is found, then replaced with
 *  freshly-serialized entries; every other line is untouched.
 *
 *  Before returning, the new text is re-parsed and compared against the
 *  intended entries — a mismatch throws rather than writes a corrupt or
 *  silently-different file, catching a quoting or validation bug before
 *  it reaches disk. */
export function writeScheduleList(file: string, entries: readonly ScheduleEntry[]): void {
  const text = existsSync(file) ? readFileSync(file, "utf-8") : "";
  const lines = text.split("\n");
  const trailing = lines.length && lines[lines.length - 1] === "" ? lines.pop() : undefined;
  const at = lines.findIndex((line) => line.startsWith("schedule:"));
  const block = entries.length > 0 ? ["schedule:", ...entries.flatMap(serializeScheduleEntry)] : [];

  let next: string[];
  if (at !== -1) {
    let end = at + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
    next = [...lines.slice(0, at), ...block, ...lines.slice(end)];
  } else if (block.length > 0) {
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    next = [...lines, ...block];
  } else {
    next = lines;
  }
  const output = next.join("\n") + (trailing !== undefined || next.length ? "\n" : "");

  const expected = entries.length > 0
    ? entries.map((e) => ({
        name: e.name, cron: e.cron, prompt: e.prompt, enabled: e.enabled !== false,
        ...(e.model ? { model: e.model } : {}),
      }))
    : undefined;
  const reparsed = parseManifest(output);
  if (!reparsed.ok || JSON.stringify(reparsed.data.schedule) !== JSON.stringify(expected)) {
    throw new Error(
      `writing the schedule list to ${file} would produce a manifest that does not reparse to the ` +
        "intended entries — refusing to write",
    );
  }

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, output);
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

/** What a lockfile at the root says about the gitignored directory the
 *  project's own commands need (spec 184).
 *
 *  Not a guess and not a scan: a lockfile IS the project stating which
 *  package manager owns its dependency tree, and each of these puts that
 *  tree in one well-known gitignored directory beside it. The Add form
 *  offered the checkout's `.gitignore` entries as autocomplete before
 *  this — help a reader still had to act on. Anything this cannot work
 *  out is left EMPTY: a wrong pre-filled answer is worse than a blank
 *  field, because it is one the reader has to notice to undo.
 *
 *  The result is the space-separated shape `worktreeLinks` takes, in a
 *  stable order, so two toolchains in one checkout propose both. */
export function suggestWorktreeLinksFromLockfile(dir: string): string {
  const rules: { files: string[]; link: string }[] = [
    { files: ["bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "package.json"], link: "node_modules" },
    { files: ["requirements.txt", "pyproject.toml", "Pipfile", "setup.py"], link: ".venv" },
  ];
  return rules
    .filter((r) => r.files.some((f) => existsSync(join(dir, f))))
    .map((r) => r.link)
    .join(" ");
}

/** Where a new project's specs would go, read off where the already-added
 *  ones keep theirs (spec 184).
 *
 *  The pattern this looks for is the one the projects on this host
 *  actually follow: one shared specs repository with a directory per
 *  project, `<parent>/<projectName>`. At least TWO projects have to
 *  agree before it counts — one is an example, not a pattern — and a
 *  project whose specs root is not named after it says nothing about
 *  where a differently-named one would go.
 *
 *  Proposes nothing where there is no pattern, rather than a guess. */
export function suggestSpecsPath(
  newName: string,
  projects: { name: string; specsPath: string | null }[],
): string {
  const byParent = new Map<string, number>();
  for (const p of projects) {
    if (!p.specsPath) continue;
    const parent = dirname(p.specsPath);
    if (basename(p.specsPath) !== p.name) continue;
    byParent.set(parent, (byParent.get(parent) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [parent, count] of byParent) {
    if (count >= 2 && count > (best === null ? 0 : byParent.get(best)!)) best = parent;
  }
  return best === null ? "" : join(best, newName);
}
