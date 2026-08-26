// Everything location-based lives here: the manifest scan, specs-root
// resolution (.aide/config AIDE_SPECS_PATH, else <project>/specs),
// walking the specs root AND archive/ (archived-ness is a directory
// fact), and each spec's title from 1-description.md's H1.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseManifest, type ScheduleEntry } from "./parse-manifest.ts";
import { projectNameError } from "./project-admin.ts";
import { archiveHeldBackReason, parseStatus } from "./parse-status.ts";
import type { ProjectView } from "../render/pages/site.ts";

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

/** Which of the two files a project's worktree links came out of.
 *  `null` when neither names any. */
export type WorktreeLinksSource = "project.yaml" | ".aide/config";

/** The gitignored paths a run must symlink into its worktree, and where
 *  they were read from (spec 184).
 *
 *  `.aide/project.yaml` first: it is COMMITTED, so a checkout that has
 *  never been configured on this machine still knows what its own
 *  commands need. `.aide/config`'s older `AIDE_WORKTREE_LINKS` is the
 *  fallback, so a project migrated on one machine keeps running on the
 *  others while both spellings exist.
 *
 *  This is one half of a hand-kept pair: `core/scripts/aide-run-spec`
 *  resolves the same two files in the same order with one anchored
 *  `sed`, and a divergence here would report a project as unconfigured
 *  that a run links perfectly well, or the reverse.
 *  `tests/fixtures/worktree-links-precedence.json` is the table both
 *  sides are checked against. */
export function resolveWorktreeLinks(
  projectDir: string,
): { links: string; source: WorktreeLinksSource | null } {
  const manifestFile = join(projectDir, ".aide", "project.yaml");
  if (existsSync(manifestFile)) {
    const parsed = parseManifest(readFileSync(manifestFile, "utf-8"));
    const fromManifest = parsed.ok ? (parsed.data.worktreeLinks ?? "").trim() : "";
    if (fromManifest) return { links: fromManifest, source: "project.yaml" };
  }
  const fromConfig = configValue(projectDir, "AIDE_WORKTREE_LINKS");
  if (fromConfig) return { links: fromConfig, source: ".aide/config" };
  return { links: "", source: null };
}

/** What a project does with its archived CODE: merge it into the default
 *  branch, or leave it on its branch for a pull request. */
export type CodeLanding = "merge" | "pr";

/** Which of the two this project chose (spec 220).
 *
 *  The COMMITTED manifest and nothing else — deliberately unlike
 *  `resolveWorktreeLinks` above, which reads `.aide/config` as a
 *  fallback. That fallback exists because `AIDE_WORKTREE_LINKS` predates
 *  the manifest and both spellings had to keep working; this key has no
 *  older spelling to migrate from, and giving it one would let a
 *  gitignored file on one machine quietly overrule the policy the repo
 *  states.
 *
 *  Absent, unrecognized, unparseable or no manifest at all → `merge`,
 *  which is what every project on the host did before this existed.
 *
 *  One half of a hand-kept pair: `core/scripts/aide-run-spec` reads the
 *  same key with one anchored `sed` to default its own `--push`, and
 *  `tests/fixtures/code-landing-precedence.json` is the table both sides
 *  are checked against. */
export function resolveCodeLanding(projectDir: string): CodeLanding {
  const manifestFile = join(projectDir, ".aide", "project.yaml");
  if (!existsSync(manifestFile)) return "merge";
  const parsed = parseManifest(readFileSync(manifestFile, "utf-8"));
  return (parsed.ok ? parsed.data.codeLanding : undefined) ?? "merge";
}

/** This project's own recurring jobs (spec 259), read fresh off the
 *  MACHINERY's checkout — the same root `resolveCodeLanding` reads,
 *  never the dashboard's read-only display clone, and never cached: the
 *  poll that acts on this wants the config a run would actually see,
 *  not a copy that can go stale between a Save and the next tick.
 *
 *  The committed manifest and nothing else, for the same reason
 *  `codeLanding` has no `.aide/config` fallback: a schedule is a team
 *  policy, and a gitignored file on one machine cannot state one.
 *  Absent, unparseable, or no manifest at all → an empty list, which
 *  reads the same as "this project has no schedule" everywhere else
 *  does. */
export function resolveSchedule(projectDir: string): ScheduleEntry[] {
  const manifestFile = join(projectDir, ".aide", "project.yaml");
  if (!existsSync(manifestFile)) return [];
  const parsed = parseManifest(readFileSync(manifestFile, "utf-8"));
  return parsed.ok ? (parsed.data.schedule ?? []) : [];
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
 *  `analyze` shows `3-solution.md`, not `2-analysis.md` (spec 181): the
 *  reviewer-perspectives routine that used to be its own `review-plan`
 *  step now runs inside `analyze`, writing a "Plan review" section into
 *  `3-solution.md` in the same run that writes the plan — so the plan
 *  and its review are one file, read together, exactly as the run
 *  produced them.
 *
 *  `archive` is the one that is not a whole file. It either moved the
 *  folder or declined to, and the page must show exactly one of those:
 *  the stamp when it is there, because a folder that MOVED is archived
 *  whatever an earlier attempt wrote into the same file. */
export function specPhaseFile(dir: string, step: string): { label: string; text: string | null } | null {
  if (step === "create") return { label: "1-description.md", text: specFileText(dir, "1-description.md") };
  if (step === "analyze") return { label: "3-solution.md", text: specFileText(dir, "3-solution.md") };
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

/** WHEN a spec was archived, off the `**Archived:** <date>` stamp the
 *  archive step writes into `4-status.md` (spec 163). The value alone,
 *  backticks stripped — both shapes are in aide's own archive today,
 *  a bare line and a Tracking-info bullet.
 *
 *  A SECOND reader of the same line as `specPhaseFile`'s, on purpose:
 *  that one hands a phase panel the whole line to print, this one hands
 *  the archive listing a value to show and sort on, and neither shape
 *  serves the other's caller.
 *
 *  `null` covers every way the stamp can be missing — no file, no line,
 *  a line with nothing after it. The stamp only started being written
 *  at spec 147, so half the archive answers `null` and the caller has a
 *  fallback for exactly that. */
export function specArchivedDate(dir: string): string | null {
  const status = specFileText(dir, "4-status.md");
  if (!status) return null;
  const m = status.match(/^.*\*\*Archived:\*\*[ \t]*(.*)$/m);
  if (!m) return null;
  return m[1].replace(/`/g, "").trim() || null;
}

/** The line the archive-time stamp is written on and read off (spec
 *  207). Its own bullet in Tracking info, beside `Archived:` — one
 *  section holds everything a machine wrote about the spec's own run.
 *
 *  Milliseconds, not the label `durationLabel` draws: `"3h12m"` and
 *  `"45s"` cannot be compared, and the archive sorts on this. */
const TIME_SPENT_LINE = /^.*\*\*Time spent \(ms\):\*\*[ \t]*(.*)$/m;

/** WHAT the spec cost in time: its phases added together, in
 *  milliseconds, off the stamp the dashboard writes when the archive
 *  step's branch lands (spec 207).
 *
 *  A THIRD reader of `4-status.md` beside `specArchivedDate` and
 *  `parse-status.ts`, on the same terms as the first: its own function,
 *  its own line, and `null` for every way the value can be missing —
 *  no file, no line, a line with nothing after it, a line with
 *  something that is not a count of milliseconds on it. Never a guess,
 *  because a guessed figure is worse than the blank cell the archive
 *  already draws for every spec finished before this existed.
 *
 *  `0` is a VALUE, not an absence, and the caller has to keep it one:
 *  a spec whose phases measured nothing measured nothing, and sinking
 *  it to the bottom of a sort beside the rows that have no figure at
 *  all would say something else. */
export function specDurationMs(dir: string): number | null {
  const status = specFileText(dir, "4-status.md");
  if (!status) return null;
  const m = status.match(TIME_SPENT_LINE);
  if (!m) return null;
  const value = m[1]!.replace(/`/g, "").trim();
  // Digits and nothing else: `Number("")` is 0 and `Number(" 12 ")` is
  // 12, and both would turn a line that says nothing into a figure.
  if (!/^\d+$/.test(value)) return null;
  const ms = Number(value);
  return Number.isSafeInteger(ms) ? ms : null;
}

/** The same line, written: first bullet under `## Tracking info`, so
 *  the figure sits where a reader of the file looks for what the run
 *  cost.
 *
 *  A file with no `## Tracking info` heading comes back UNCHANGED —
 *  there is nowhere to put the line, and inventing a section is a
 *  guess about a file this function does not own. The caller compares
 *  what it got back against what it passed in and writes nothing when
 *  they are equal, which is why this returns a string rather than
 *  refusing with `null` the way `withDependsOnLine` does: nothing is
 *  reported to anybody here, so there is nobody to report to.
 *
 *  The caller is also what keeps it from being written twice — see
 *  `specDurationMs` above, which is asked first. */
export function stampDuration(content: string, ms: number): string {
  return content.replace(
    /^(## Tracking info[ \t]*\r?\n(?:[ \t]*\r?\n)?)/m,
    `$1- **Time spent (ms):** \`${ms}\`\n`,
  );
}

// `[ \t]*`, never `\s*`: `\s` matches a newline, and a trailing `\s*`
// would run an empty field straight into the `---` on the next line.
const DEPENDS_ON_LINE = /^[ \t]*-[ \t]*\*\*Depends on:\*\*[ \t]*(.*)$/m;
// The same line with the break that ends it, for taking it out: leaving
// the newline behind would put a blank line where the line used to be.
const DEPENDS_ON_LINE_WITH_BREAK = /^[ \t]*-[ \t]*\*\*Depends on:\*\*[ \t]*.*(\n|$)/m;

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
  const m = text.match(DEPENDS_ON_LINE);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.replace(/`/g, "").trim())
    .filter(Boolean);
}

/** The same line, taken OUT of a description's text (spec 166).
 *
 *  CRLF is normalised on the way, because a textarea posts CRLF
 *  whatever the file had and `asFileText` (`specs-pull.ts`) normalises
 *  it again before the write — a strip working on the raw post would
 *  miss the line the write then keeps. */
export function stripDependsOnLine(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(DEPENDS_ON_LINE_WITH_BREAK, "");
}

/** The text with the line naming exactly `ids`, or with no line at all
 *  when `ids` is empty (spec 166).
 *
 *  The Edit page's field is the SOLE writer of this line: whatever the
 *  submitted text says about it is stripped first, so a hand-typed line
 *  and the field can never disagree about one fact.
 *
 *  Placed right after `- **Created:**`, which every template writes
 *  (`core/templates/todo/1-description.md.template`) and which is where
 *  the line already sits in the specs that have one. `null` when there
 *  is no such line to anchor on and `ids` names something — the caller
 *  refuses rather than guessing where Tracking info would have been.
 *  Removing needs no anchor, so an empty `ids` is never `null`. */
export function withDependsOnLine(text: string, ids: string[]): string | null {
  const stripped = stripDependsOnLine(text);
  if (ids.length === 0) return stripped;
  const created = stripped.match(/^[ \t]*-[ \t]*\*\*Created:\*\*.*$/m);
  if (!created) return null;
  const line = `- **Depends on:** ${ids.map((id) => `\`${id}\``).join(", ")}`;
  const at = created.index! + created[0].length;
  return `${stripped.slice(0, at)}\n${line}${stripped.slice(at)}`;
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
