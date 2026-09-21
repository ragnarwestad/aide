// Walking a projects root: which directories are projects, which specs
// each one has, and which directories are not projects yet. Split out
// of discover.ts by theme (split discover.ts by theme).

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseManifest, type ManifestResult } from "../parse-manifest.ts";
import { parseStatus, type StatusInfo } from "../parse-status";
import { failedCount, notVerifiedCount } from "../parse-status/not-verified.ts";
import { readSpecState } from "../parse-spec-state.ts";
import { configSpecsPath } from "./config.ts";
import { specDependsOn } from "./depends-on.ts";
import { specClosed, specDescription, specTitle } from "./spec-files.ts";

export interface SpecRef {
  folder: string;
  dir: string;
  archived: boolean;
  /** Closed rather than archived (spec 406) — always `false` for a spec
   *  not under `archive/`, since the `**Closed:**` stamp is only ever
   *  written there. Kept apart from `archived` rather than folded into
   *  it: both live under the same folder physically, but read as two
   *  different states everywhere a spec's state is shown (REQ-7). */
  closed: boolean;
  /** How many Acceptance rows of an archived, not closed spec are marked
   *  Not verified, from its state file; absent when none. A live
   *  spec's count is read where its branch is asked (spec-lookup.ts). */
  notVerified?: number;
  /** The same, for rows marked Failed. */
  failed?: number;
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

/** A `SpecRef` with its `4-status.md` parsed, or `null` where the spec
 *  has none — the shape `buildProjectViews` below returns, and what a
 *  page shows for one spec. */
export interface SpecView extends SpecRef {
  status: StatusInfo | null;
}

/** What `buildProjectViews` below returns for one project: its parsed
 *  manifest and every spec's parsed status. */
export interface ProjectView {
  name: string;
  manifest: ManifestResult;
  specs: SpecView[];
}

function specFolders(root: string, archived: boolean): SpecRef[] {
  if (!existsSync(root)) return [];
  const out: SpecRef[] = [];
  for (const entry of readdirSync(root)) {
    if (!/^\d+-/.test(entry)) continue;
    const dir = join(root, entry);
    if (!statSync(dir).isDirectory()) continue;
    const closed = archived && specClosed(dir);
    const rows = archived && !closed ? (readSpecState(dir)?.acceptanceCriteria ?? []) : [];
    const notVerified = notVerifiedCount(rows);
    const failed = failedCount(rows);
    out.push({
      folder: entry,
      dir,
      archived,
      closed,
      ...(notVerified > 0 ? { notVerified } : {}),
      ...(failed > 0 ? { failed } : {}),
      title: specTitle(dir),
      description: specDescription(dir),
      dependsOn: specDependsOn(dir),
    });
  }
  return out;
}

/** Where a caller of its own wants a project's spec folders listed FROM,
 *  when that is not the checkout the scan walked (spec 218).
 *
 *  The dashboard resolves a run's `--spec` against a clone it owns
 *  (spec 205), and the list has to name what a run can actually resolve
 *  — a folder committed in the person's checkout and never pushed got a
 *  row offering steps that every one of them refused. A plain optional
 *  function, and not a `DashboardCheckout` parameter: this module knows
 *  nothing about clones, origins or git, and the static generator has no
 *  checkout to offer and passes nothing. */
export type OwnedSpecsRoot = (project: string) => string | undefined;

/** Where a project's manifest is read from when its own directory holds
 *  none (spec 512): the dashboard's clone carries the manifest a run
 *  reads — the team's tracked one, else a copy of the settings the
 *  dashboard keeps — so a project added with no manifest in its
 *  repository is still a project. Same shape as `OwnedSpecsRoot`, for the
 *  same reason: this module knows nothing about clones. */
export type ManifestFallback = (project: string) => string | undefined;

/** The fallback that names the manifest inside whichever directory
 *  `dirOf` gives for a project — the dashboard's own checkout, for every
 *  caller that has `machineryProjectDir`; none for a caller that has no
 *  checkout to ask. */
export const manifestInside = (dirOf?: (project: string) => string): ManifestFallback | undefined =>
  dirOf && ((project) => join(dirOf(project), ".aide", "project.yaml"));

/** The manifest a project is read from: the fallback's file when it
 *  exists (the file a run reads), else the entry's own. `null` for a
 *  project with neither. */
function manifestOf(dir: string, entry: string, fallback?: ManifestFallback): string | null {
  const derived = fallback?.(entry);
  if (derived && existsSync(derived)) return derived;
  const own = join(dir, ".aide", "project.yaml");
  return existsSync(own) ? own : null;
}

export function discoverProjects(
  root: string,
  ownedSpecsRoot?: OwnedSpecsRoot,
  manifestFallback?: ManifestFallback,
): DiscoveredProject[] {
  const projects: DiscoveredProject[] = [];
  if (!existsSync(root)) return projects;
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    let manifestPath: string | null;
    try {
      if (!statSync(dir).isDirectory()) continue;
      manifestPath = manifestOf(dir, entry, manifestFallback);
    } catch {
      continue; // dangling symlink or unreadable entry — not a project
    }
    if (!manifestPath) continue;
    const specsRoot = configSpecsPath(dir) ?? join(dir, "specs");
    // `specsRoot` on the result stays the person's own even when the
    // folders come from somewhere else: the write path's translation
    // (`dashboardSpecDir`) and the `fs.watch` that redraws a page on a
    // local edit both read it, and only which directory is ENUMERATED
    // moves.
    const listedFrom = ownedSpecsRoot?.(entry) ?? specsRoot;
    const specs = [
      ...specFolders(listedFrom, false),
      ...specFolders(join(listedFrom, "archive"), true),
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
export function buildProjectViews(
  root: string,
  ownedSpecsRoot?: OwnedSpecsRoot,
  manifestFallback?: ManifestFallback,
): ProjectView[] {
  return discoverProjects(root, ownedSpecsRoot, manifestFallback).map((p) => ({
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

/** The gitignored paths of a checkout that could plausibly be worktree
 *  links — read off its own `.gitignore`, which is the one place on the
 *  host that names them (spec 140).
 *
 *  Nothing can DERIVE which of them a project's test command actually
 *  needs, which is why the Add form asks; this only stops the reader
 *  having to go and open the file. So it offers exactly what
 *  `worktreeLinks` can take and no more: literal, top-level
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
