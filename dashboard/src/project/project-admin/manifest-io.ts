// Naming a project, and writing the files that describe it: the
// manifest, the personal `.aide/config`, and the worktree-links rule
// both readers refuse the same value by.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { stringify } from "yaml";
import { PREVIEW_FROMS } from "../parse-manifest.ts";

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
 *  Everything past those two is set from the Config tab. Serialized by
 *  the same `yaml` package that reads it back, so nobody here has to get
 *  quoting right on a description's behalf. */
export function minimalManifest(name: string, description?: string): string {
  return stringify({ name, ...(description ? { description } : {}) });
}

/** Set (or clear) ONE top-level scalar in a `.aide/project.yaml`, or
 *  one key inside a top-level block, written `block.key`
 *  (`manifestWithBlockKey`), touching nothing else in the file (spec
 *  184).
 *
 *  The same discipline `writeAideConfig` applies to `.aide/config`, and
 *  for a sharper reason: a manifest is a file a person wrote by hand,
 *  with comments, key order and multi-line blocks that a
 *  parse-mutate-`stringify()` round trip promises nothing about. Only
 *  the one anchored line is ever touched.
 *
 *  The line is written PLAIN and unquoted, because the reader on the
 *  other side is one anchored `sed` in `aide-run-spec` and not a YAML
 *  parser — a quoted value would read back there as empty, which is
 *  indistinguishable from "no links configured".
 *
 *  The one exception is a key only the YAML parser reads (`description`):
 *  it is written as YAML needs it, quoted where a plain line would not read
 *  back, and replaces the lines a folded or block form took.
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
 *  `saveSpecFile`). `label` names the file in the one refusal. One
 *  top-level scalar, or one key inside a top-level block, written
 *  `block.key`. */
export function manifestWithScalar(text: string, key: string, value: string, label: string): string {
  const dot = key.indexOf(".");
  if (dot !== -1) return manifestWithBlockKey(text, key.slice(0, dot), key.slice(dot + 1), value, label);
  const lines = text.split("\n");
  // A trailing newline splits into a final empty element; it is put back
  // by the join, so the file's shape survives a no-op.
  const trailing = lines.length && lines[lines.length - 1] === "" ? lines.pop() : undefined;
  const yamlOnly = YAML_ONLY_KEYS.has(key);
  // Written in mapping context, so a value a plain line would not read back
  // is quoted, and `lineWidth: 0` keeps a long one on the one line.
  const line = yamlOnly && value ? stringify({ [key]: value }, { lineWidth: 0 }).trimEnd() : `${key}: ${value}`;
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (at !== -1) {
    const next = lines[at + 1];
    const ownValue = lines[at]!.slice(key.length + 1).trim() !== "";
    if (next !== undefined && /^\s+-\s/.test(next) && !(yamlOnly && ownValue)) {
      throw new Error(
        `${key} in ${label} is a YAML list, and this writes a single line — edit it by hand or make it a scalar first`,
      );
    }
    const span = yamlOnly ? 1 + continuationLines(lines, at) : 1;
    if (value) lines.splice(at, span, line);
    else lines.splice(at, span);
  } else if (value) {
    // Appended at the end rather than slotted in: a manifest's key order
    // is its author's, and there is no position here that is more
    // correct than the one after everything they wrote.
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(line);
  } else {
    return text; // nothing to clear, and nothing to write
  }
  return lines.join("\n") + (trailing !== undefined || lines.length ? "\n" : "");
}

/** The keys only the YAML parser reads: bash's anchored `sed` reads none
 *  of them, so they are written the way YAML needs, not the plain way the
 *  others are. */
const YAML_ONLY_KEYS = new Set(["description"]);

/** How many lines after `lines[at]` belong to its value: the indented ones,
 *  and a blank line only when an indented line follows it. A line at column
 *  0 — a key, a comment, `---` — ends them. */
function continuationLines(lines: string[], at: number): number {
  let count = 0;
  let blanks = 0;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (isBlank(line)) blanks++;
    else if (isIndented(line)) {
      count += blanks + 1;
      blanks = 0;
    } else break;
  }
  return count;
}

const isBlank = (line: string): boolean => line.trim() === "";
const isComment = (line: string): boolean => line.trimStart().startsWith("#");
const isIndented = (line: string): boolean => line.startsWith(" ") || line.startsWith("\t");
const indentOf = (line: string): string => line.match(/^[ \t]*/)![0];

/** Set (or, with an empty value, remove) the line `<child>: <value>` inside
 *  the top-level block `<block>:`, one line and never a round trip through
 *  a YAML parser, for the reason `upsertManifestScalar` gives.
 *
 *  The block runs from its header to the first line at column 0 that is
 *  not a comment: a comment at any column and a blank line never end it.
 *  A new child goes after the block's last indented, non-blank line, at
 *  the block's own indentation; a block that is not there is appended.
 *
 *  Refuses, rather than guesses at, every shape where one line is not the
 *  whole of the thing: a header with a value on it, a list under it, and a
 *  child whose value runs over deeper lines. */
function manifestWithBlockKey(text: string, block: string, child: string, value: string, label: string): string {
  const lines = text.split("\n");
  const trailing = lines.length && lines[lines.length - 1] === "" ? lines.pop() : undefined;
  const finish = (): string => lines.join("\n") + (trailing !== undefined || lines.length ? "\n" : "");
  const notABlock = new Error(`${block} in ${label} is not a block of keys — edit it by hand`);

  const header = lines.findIndex((line) => line.startsWith(`${block}:`));
  if (header === -1) {
    if (!value) return text; // nothing to clear, and nothing to write
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(`${block}:`, `  ${child}: ${value}`);
    return finish();
  }
  const after = lines[header]!.slice(block.length + 1).trim();
  if (after !== "" && !after.startsWith("#")) throw notABlock;

  let end = header + 1;
  while (end < lines.length && (isBlank(lines[end]!) || isComment(lines[end]!) || isIndented(lines[end]!))) end++;
  const first = lines.slice(header + 1).find((line) => !isBlank(line) && !isComment(line));
  if (first !== undefined && /^\s*-(\s|$)/.test(first)) throw notABlock;

  const inside = lines.slice(header + 1, end);
  const indent = indentOf(inside.find((line) => isIndented(line) && !isComment(line)) ?? "  ") || "  ";
  const at = inside.findIndex((line) => line.startsWith(`${indent}${child}:`) && /^(\s|$)/.test(line.slice(indent.length + child.length + 1)));
  if (at !== -1) {
    const own = header + 1 + at;
    for (const line of lines.slice(own + 1, end)) {
      if (isBlank(line) || isComment(line)) continue;
      if (indentOf(line).length <= indent.length) break;
      throw new Error(`${block}.${child} in ${label} runs over several lines, and this writes a single line — edit it by hand`);
    }
    if (value) lines[own] = `${indent}${child}: ${value}`;
    else lines.splice(own, 1);
    return finish();
  }
  if (!value) return text; // nothing to clear, and nothing to write
  let last = header;
  for (let i = header + 1; i < end; i++) if (isIndented(lines[i]!) && !isBlank(lines[i]!)) last = i;
  lines.splice(last + 1, 0, `${indent}${child}: ${value}`);
  return finish();
}

/** Why this word cannot say how a branch is tried. The Add form and the
 *  Config tab's save refuse an unknown one in the same sentence. */
export function previewFromError(word: string): string {
  const words = `${PREVIEW_FROMS.slice(0, -1).join(", ")} or ${PREVIEW_FROMS[PREVIEW_FROMS.length - 1]}`;
  return `how a branch is tried must be ${words} — not "${word}"`;
}

/** What a one-line setting's value is: every line break, with the space
 *  around it, folded to one space, and the ends trimmed. The client's
 *  `foldLineBreaks` (`specs-client/forms.ts`) is the same expression;
 *  a test pairs them. */
export function oneLine(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, " ").trim();
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
 *  `key` names the SETTING the value came out of, so a refusal is read
 *  as an instruction to go and edit it. Defaults to the manifest's,
 *  which is where every worktree-links value is read from now (spec
 *  549). */
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
        `${key} names a build output, not a dependency cache: ${entry} — ` +
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
