// Everything location-based lives here: the manifest scan, specs-root
// resolution (.aide/config AIDE_SPECS_PATH, else <project>/specs),
// walking the specs root AND archive/ (archived-ness is a directory
// fact), and each spec's title from 1-description.md's H1.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "./parse-manifest.ts";
import { projectNameError } from "./project-admin.ts";
import { archiveHeldBackReason, parseStatus } from "./parse-status.ts";
import type { ProjectView } from "./render/site.ts";

export interface SpecRef {
  folder: string;
  dir: string;
  archived: boolean;
  title: string | null;
  /** What the spec is ABOUT. The title says `02-job-detail-view`; this
   *  says why anyone queued it (spec 02). */
  description: string | null;
  /** Folder names from 1-description.md's `Depends on:` line (spec 92),
   *  in the order written. Empty when the spec names none. */
  dependsOn: string[];
}

export interface DiscoveredProject {
  name: string;
  dir: string;
  manifestPath: string;
  specsRoot: string;
  specs: SpecRef[];
}

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

const configSpecsPath = (projectDir: string): string | null => configValue(projectDir, "AIDE_SPECS_PATH");

function specTitle(dir: string): string | null {
  const desc = join(dir, "1-description.md");
  if (!existsSync(desc)) return null;
  const m = readFileSync(desc, "utf-8").match(/^#\s+(.+)$/m);
  if (!m) return null;
  // The H1 convention is "<title> - Description" — the doc-type
  // suffix is noise in a spec listing.
  return m[1].trim().replace(/\s*-\s*Description$/i, "");
}

/** The four files a spec is made of, in the order they are written and
 *  the order a reader goes through them (spec 150). The layout itself
 *  is `core/rules/spec-structure.md`'s; this is the dashboard's copy of
 *  the NAMES, which is all it needs to show them. */
export const SPEC_FILES = [
  "1-description.md",
  "2-analysis.md",
  "3-solution.md",
  "4-status.md",
] as const;

/** One spec file, whole. `null` covers all three ways there is nothing
 *  to show — the file is not there, it is a directory, it cannot be
 *  read — because the page says the same thing about each of them, and
 *  a spec halfway through the workflow legitimately has three of the
 *  four missing.
 *
 *  Raw text, not an excerpt: `specTitle` and `specDescription` below
 *  read one line and one section, and the spec page exists because
 *  neither of those is the file. */
export function specFileText(dir: string, name: string): string | null {
  try {
    const path = join(dir, name);
    if (!existsSync(path) || !statSync(path).isFile()) return null;
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/** The body under a `## <heading>` line, to the next heading or the next
 *  `---`. No markdown parser: that IS the whole rule, and it is the one
 *  `specDescription` has always used — which is why both callers use
 *  this rather than each carrying a copy of the regex.
 *
 *  Null, never an empty string, for a heading nobody wrote and for one
 *  with nothing under it: the page tells "no such section" and "written
 *  and empty" apart from a section it can show. */
export function markdownSection(text: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = text.match(new RegExp(`^##\\s+${escaped}\\s*$`, "m"));
  if (!start || start.index === undefined) return null;
  const body = text.slice(start.index + start[0].length);
  const end = body.search(/^(#{1,6}\s|---\s*$)/m);
  return (end === -1 ? body : body.slice(0, end)).trim() || null;
}

// The prose under `## Description` — the section every 1-description.md
// the templates produce has, and the one a reader currently leaves the
// dashboard to read.
export function specDescription(dir: string): string | null {
  const text = specFileText(dir, "1-description.md");
  if (text === null) return null;
  const body = markdownSection(text, "Description");
  if (body === null) return null;
  return body
    // The template's own note about the field is not part of it.
    .replace(/^_\(This field can be edited manually[^\n]*\n?/gm, "")
    .trim() || null;
}

/** What ONE workflow step wrote, as a labelled slice of the spec's own
 *  files (spec 150). A phase's page is where a reader goes to find out
 *  what that phase did, and it used to show the same `## Description`
 *  prose every other page showed.
 *
 *  `null` is "this step writes no file of its own" — `resolve` merges,
 *  and a step the list does not know is not a step. A named phase whose
 *  file is not written yet keeps its NAME and answers `text: null`: the
 *  reader asked what analyze produced, and "nothing yet" is the answer.
 *
 *  `archive` is the one that is not a whole file. It either moved the
 *  folder or declined to, and the page must show exactly one of those:
 *  the stamp when it is there, because a folder that MOVED is archived
 *  whatever an earlier attempt wrote into the same file. */
export function specPhaseFile(dir: string, step: string): { label: string; text: string | null } | null {
  if (step === "create") return { label: "1-description.md", text: specFileText(dir, "1-description.md") };
  if (step === "analyze") return { label: "2-analysis.md", text: specFileText(dir, "2-analysis.md") };
  if (step === "review-plan") {
    const solution = specFileText(dir, "3-solution.md");
    return {
      label: "3-solution.md — Plan review",
      text: solution === null ? null : markdownSection(solution, "Plan review"),
    };
  }
  if (step === "implement") return { label: "4-status.md", text: specFileText(dir, "4-status.md") };
  if (step === "archive") {
    const status = specFileText(dir, "4-status.md");
    const stamp = status?.match(/^.*\*\*Archived:\*\*.*$/m)?.[0]?.trim() ?? null;
    // The same reader the row's own held-back mark uses, so the two
    // cannot word one fact differently.
    const held = status ? archiveHeldBackReason(status) : null;
    return { label: "4-status.md", text: stamp ?? held };
  }
  return null;
}

// The `Depends on:` line in Tracking info (spec 92) — the specs this one
// builds on, comma-separated, backticks and whitespace stripped. A
// SECOND reader of the same on-disk format, not a shared one: the shell
// side has had `aide_spec_dependencies` since the line existed, and a
// parser shared across bash and TypeScript is more machinery than two
// lines of comma-splitting justify.
export function specDependsOn(dir: string): string[] {
  const desc = join(dir, "1-description.md");
  if (!existsSync(desc)) return [];
  let text: string;
  try {
    text = readFileSync(desc, "utf-8");
  } catch {
    return [];
  }
  // `[ \t]*`, never `\s*`: `\s` matches a newline, and a trailing `\s*`
  // would run an empty field straight into the `---` on the next line.
  const m = text.match(/^[ \t]*-[ \t]*\*\*Depends on:\*\*[ \t]*(.*)$/m);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.replace(/`/g, "").trim())
    .filter(Boolean);
}

function specFolders(root: string, archived: boolean): SpecRef[] {
  if (!existsSync(root)) return [];
  const out: SpecRef[] = [];
  for (const entry of readdirSync(root)) {
    if (!/^\d+-/.test(entry)) continue;
    const dir = join(root, entry);
    if (!statSync(dir).isDirectory()) continue;
    out.push({
      folder: entry,
      dir,
      archived,
      title: specTitle(dir),
      description: specDescription(dir),
      dependsOn: specDependsOn(dir),
    });
  }
  return out;
}

export function discoverProjects(root: string): DiscoveredProject[] {
  const projects: DiscoveredProject[] = [];
  if (!existsSync(root)) return projects;
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    const manifestPath = join(dir, ".aide", "project.yaml");
    try {
      if (!statSync(dir).isDirectory() || !existsSync(manifestPath)) continue;
    } catch {
      continue; // dangling symlink or unreadable entry — not a project
    }
    const specsRoot = configSpecsPath(dir) ?? join(dir, "specs");
    const specs = [
      ...specFolders(specsRoot, false),
      ...specFolders(join(specsRoot, "archive"), true),
    ].sort((a, b) => a.folder.localeCompare(b.folder, "en", { numeric: true }));
    projects.push({ name: entry, dir, manifestPath, specsRoot, specs });
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

/** The inverse of `discoverProjects`: the directories under the same
 *  root that carry NO manifest — checkouts on this host that are not
 *  projects yet (spec 131). The Add-project form offers these to be
 *  PICKED, because the one path its own check accepts follows from the
 *  projects root and the name, and asking a reader to type it was
 *  asking for something only the server knew.
 *
 *  Bare directory names, not paths: the picked value is the project's
 *  name as well as its location, and `addProject` resolves it against
 *  the same root. A name that could never be a project name is left out
 *  — offering it would only produce a refusal nobody could act on. The
 *  try/catch is `discoverProjects`' own: a dangling symlink is not a
 *  checkout, and it is not a crash either. */
export function discoverUnclaimedDirectories(root: string): string[] {
  const found: string[] = [];
  if (!existsSync(root)) return found;
  for (const entry of readdirSync(root)) {
    if (projectNameError(entry) !== null) continue;
    const dir = join(root, entry);
    try {
      if (!statSync(dir).isDirectory() || existsSync(join(dir, ".aide", "project.yaml"))) continue;
    } catch {
      continue; // dangling symlink or unreadable entry — nothing to offer
    }
    found.push(entry);
  }
  return found.sort((a, b) => a.localeCompare(b));
}

/** The gitignored paths of a checkout that could plausibly be worktree
 *  links — read off its own `.gitignore`, which is the one place on the
 *  host that names them (spec 140).
 *
 *  Nothing can DERIVE which of them a project's test command actually
 *  needs, which is why the Add form asks; this only stops the reader
 *  having to go and open the file. So it offers exactly what
 *  `AIDE_WORKTREE_LINKS` can take and no more: literal, top-level
 *  entries. A glob names no one path, a negation is not an ignore, a
 *  comment is not an entry, and a nested path is a link `aide-run-spec`
 *  would have to make a directory for. A trailing slash is dropped —
 *  `.venv/` and `.venv` ignore the same directory, and the config
 *  writes it without one. */
export function gitignoreCandidates(dir: string): string[] {
  const file = join(dir, ".gitignore");
  try {
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("!") && !/[*?[\]]/.test(line))
      .map((line) => line.replace(/\/+$/, ""))
      .filter((line) => line && !line.includes("/"));
  } catch {
    return []; // unreadable is not a crash — it is nothing to suggest
  }
}

/** Everything a page shows about a projects root: the manifest scan
 *  above, plus each project's parsed manifest and each spec's parsed
 *  status. The generator and the served `/projects` page (spec 115) both
 *  want exactly this, from exactly these files — so it is written once
 *  here rather than twice, the way `serve.ts` already refuses to read
 *  one file for two answers.
 *
 *  A spec with no `4-status.md` gets `null`, never an invented zero: the
 *  page tells "not started" and "nothing written down" apart. */
export function buildProjectViews(root: string): ProjectView[] {
  return discoverProjects(root).map((p) => ({
    name: p.name,
    manifest: parseManifest(readFileSync(p.manifestPath, "utf-8")),
    specs: p.specs.map((s) => {
      const statusPath = join(s.dir, "4-status.md");
      return {
        ...s,
        status: existsSync(statusPath) ? parseStatus(readFileSync(statusPath, "utf-8")) : null,
      };
    }),
  }));
}
