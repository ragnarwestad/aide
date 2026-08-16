// Everything location-based lives here: the manifest scan, specs-root
// resolution (.aide/config AIDE_SPECS_PATH, else <project>/specs),
// walking the specs root AND archive/ (archived-ness is a directory
// fact), and each spec's title from 1-description.md's H1.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface SpecRef {
  folder: string;
  dir: string;
  archived: boolean;
  title: string | null;
  /** What the spec is ABOUT. The title says `02-job-detail-view`; this
   *  says why anyone queued it (spec 02). */
  description: string | null;
}

export interface DiscoveredProject {
  name: string;
  dir: string;
  manifestPath: string;
  specsRoot: string;
  specs: SpecRef[];
}

function configSpecsPath(projectDir: string): string | null {
  const cfg = join(projectDir, ".aide", "config");
  if (!existsSync(cfg)) return null;
  for (const line of readFileSync(cfg, "utf-8").split("\n")) {
    const m = line.match(/^AIDE_SPECS_PATH=(.*)$/);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

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

function specFolders(root: string, archived: boolean): SpecRef[] {
  if (!existsSync(root)) return [];
  const out: SpecRef[] = [];
  for (const entry of readdirSync(root)) {
    if (!/^\d+-/.test(entry)) continue;
    const dir = join(root, entry);
    if (!statSync(dir).isDirectory()) continue;
    out.push({ folder: entry, dir, archived, title: specTitle(dir), description: specDescription(dir) });
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
