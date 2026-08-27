// Reading one spec's own files: its title, its description, what one
// workflow step wrote, and the archive/duration stamps.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { archiveHeldBackReason } from "../parse-status.ts";

export function specTitle(dir: string): string | null {
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
