// Everything location-based lives here: the manifest scan, specs-root
// resolution (.aide/config AIDE_SPECS_PATH, else <project>/specs),
// walking the specs root AND archive/ (archived-ness is a directory
// fact), and each spec's title from 1-description.md's H1.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "./parse-manifest.ts";
import { parseStatus } from "./parse-status.ts";
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

// The prose under `## Description` — the section every 1-description.md
// the templates produce has, and the one a reader currently leaves the
// dashboard to read. No markdown parser: the section runs to the next
// heading or the next `---`, and that is the whole rule.
export function specDescription(dir: string): string | null {
  const desc = join(dir, "1-description.md");
  if (!existsSync(desc)) return null;
  let text: string;
  try {
    text = readFileSync(desc, "utf-8");
  } catch {
    return null;
  }
  const start = text.match(/^##\s+Description\s*$/m);
  if (!start || start.index === undefined) return null;
  const body = text.slice(start.index + start[0].length);
  const end = body.search(/^(#{1,6}\s|---\s*$)/m);
  return (end === -1 ? body : body.slice(0, end))
    // The template's own note about the field is not part of it.
    .replace(/^_\(This field can be edited manually[^\n]*\n?/gm, "")
    .trim() || null;
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
