// The `Depends on:` line in a spec's own `1-description.md` (spec 92):
// reading it, stripping it, and writing it back. Split out of
// discover.ts by theme (split discover.ts by theme).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
