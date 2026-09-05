// The `Acceptance:` line in a spec's own `1-description.md` (spec 394):
// reading it, stripping it, and writing it back — the direct mirror of
// `depends-on.ts`'s own three functions, for the OTHER whole-spec fact
// that sits above the tabs.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// `[ \t]*`, never `\s*`, for the same reason `depends-on.ts` gives: `\s`
// matches a newline, and a trailing `\s*` would run an empty field
// straight into the `---` on the next line.
const ACCEPTANCE_LINE = /^[ \t]*-[ \t]*\*\*Acceptance:\*\*[ \t]*not required[ \t]*$/m;
// The same line with the break that ends it, for taking it out.
const ACCEPTANCE_LINE_WITH_BREAK = /^[ \t]*-[ \t]*\*\*Acceptance:\*\*[ \t]*.*(\n|$)/m;

/** Whether this spec's own Tracking info says acceptance ticking is not
 *  required (spec 394). Absence — like a spec written before this line
 *  existed — means "required", the same convention `specDependsOn` uses
 *  for "nothing": the archiving gate keeps holding on unticked rows
 *  exactly as it does today. */
export function specAcceptanceNotRequired(dir: string): boolean {
  const desc = join(dir, "1-description.md");
  if (!existsSync(desc)) return false;
  let text: string;
  try {
    text = readFileSync(desc, "utf-8");
  } catch {
    return false;
  }
  return ACCEPTANCE_LINE.test(text);
}

/** The same line, taken OUT of a description's text. CRLF is normalised
 *  on the way, for the same reason `stripDependsOnLine` normalises it. */
export function stripAcceptanceLine(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(ACCEPTANCE_LINE_WITH_BREAK, "");
}

/** The text with a `- **Acceptance:** not required` line, or with no
 *  line at all when `notRequired` is false (spec 394).
 *
 *  Placed right after `- **Created:**`, the same anchor
 *  `withDependsOnLine` uses — `null` when there is no such line to
 *  anchor on and `notRequired` is true; removing needs no anchor, so
 *  `false` is never `null`. */
export function withAcceptanceLine(text: string, notRequired: boolean): string | null {
  const stripped = stripAcceptanceLine(text);
  if (!notRequired) return stripped;
  const created = stripped.match(/^[ \t]*-[ \t]*\*\*Created:\*\*.*$/m);
  if (!created) return null;
  const line = "- **Acceptance:** not required";
  const at = created.index! + created[0].length;
  return `${stripped.slice(0, at)}\n${line}${stripped.slice(at)}`;
}
