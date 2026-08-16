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
  return m ? m[1].trim() : null;
}

function specFolders(root: string, archived: boolean): SpecRef[] {
  if (!existsSync(root)) return [];
  const out: SpecRef[] = [];
  for (const entry of readdirSync(root)) {
    if (!/^\d+-/.test(entry)) continue;
    const dir = join(root, entry);
    if (!statSync(dir).isDirectory()) continue;
    out.push({ folder: entry, dir, archived, title: specTitle(dir) });
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
