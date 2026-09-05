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

/** Whether this spec was CLOSED rather than archived (spec 406), off
 *  the `**Closed:** <date> — <reason>` stamp `aide-close-spec` writes —
 *  the same stamp `core/scripts/lib/spec-state.sh`'s
 *  `_spec_state_closed_json` reads on the bash side. Last match wins,
 *  same rule as `specArchivedDate`. */
export function specClosed(dir: string): boolean {
  const status = specFileText(dir, "4-status.md");
  return status ? /\*\*Closed:\*\*/.test(status) : false;
}

/** WHEN this spec was closed, off the same `**Closed:**` stamp —
 *  `specArchivedDate`'s sibling. `null` covers a spec never closed. */
export function specClosedDate(dir: string): string | null {
  const status = specFileText(dir, "4-status.md");
  if (!status) return null;
  const m = status.match(/^.*\*\*Closed:\*\*[ \t]*([0-9-]*)/m);
  if (!m) return null;
  return m[1].trim() || null;
}

/** The reason typed by the person who closed this spec (REQ-5), off the
 *  same `**Closed:**` stamp. `null` covers a spec that was never closed
 *  and one whose stamp somehow carries no reason. */
export function specCloseReason(dir: string): string | null {
  const status = specFileText(dir, "4-status.md");
  if (!status) return null;
  const m = status.match(/^.*\*\*Closed:\*\*[ \t]*[0-9-]*[ \t]*—[ \t]*(.*)$/m);
  if (!m) return null;
  return m[1].trim() || null;
}

