// Walking a projects root: which directories are projects, which specs
// each one has, and which directories are not projects yet. Split out
// of discover.ts by theme (split discover.ts by theme).

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseManifest, type ManifestResult } from "../parse-manifest.ts";
import { projectNameError } from "../project-admin.ts";
import { parseStatus, type StatusInfo } from "../parse-status.ts";
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
    out.push({
      folder: entry,
      dir,
      archived,
      closed: archived && specClosed(dir),
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

export function discoverProjects(root: string, ownedSpecsRoot?: OwnedSpecsRoot): DiscoveredProject[] {
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

/** Everything a page shows about a projects root: the manifest scan
 *  above, plus each project's parsed manifest and each spec's parsed
 *  status. The generator and the served `/projects` page (spec 115) both
 *  want exactly this, from exactly these files — so it is written once
 *  here rather than twice, the way `serve.ts` already refuses to read
 *  one file for two answers.
 *
 *  A spec with no `4-status.md` gets `null`, never an invented zero: the
 *  page tells "not started" and "nothing written down" apart. */
export function buildProjectViews(root: string, ownedSpecsRoot?: OwnedSpecsRoot): ProjectView[] {
  return discoverProjects(root, ownedSpecsRoot).map((p) => ({
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
