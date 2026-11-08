// Whether a spec asks to choose between the approaches its analysis finds:
// the New spec form's "Let me choose the approach" box, recorded by
// `aide-run-spec` as the `Let me choose the approach:` line in the new
// spec's own `1-description.md`. The runner reads the same line in bash
// (`aide_spec_choose_approach`) to tell analyze, and
// core/tests/fixtures/choose-approach-line.json is the table both sides read.

// `[ \t]*`, never `\s*`, for the reason `depends-on.ts` gives: `\s`
// matches a newline.
const CHOOSE_LINE = /^[ \t]*-[ \t]*\*\*Let me choose the approach:\*\*[ \t]*(.*?)[ \t]*$/m;

/** Whether the description's line says `yes`; absent or anything else is no. */
export function chooseApproachIn(text: string): boolean {
  return text.replace(/\r\n/g, "\n").match(CHOOSE_LINE)?.[1] === "yes";
}

const CHOOSE_LINE_WITH_BREAK = /^[ \t]*-[ \t]*\*\*Let me choose the approach:\*\*.*(\n|$)/m;

/** The text with its `Let me choose the approach:` line set to yes or no,
 *  as `aide_spec_record_choose_approach` writes it: directly after the
 *  `Acceptance criteria checks:` line, or after `Created:` when there is
 *  none; `null` when there is no Created line. */
export function withChooseApproachLine(text: string, choose: boolean): string | null {
  const stripped = text.replace(/\r\n/g, "\n").replace(CHOOSE_LINE_WITH_BREAK, "");
  if (!/^[ \t]*-[ \t]*\*\*Created:\*\*/m.test(stripped)) return null;
  const anchor =
    stripped.match(/^[ \t]*-[ \t]*\*\*Acceptance criteria checks:\*\*.*$/m) ??
    stripped.match(/^[ \t]*-[ \t]*\*\*Created:\*\*.*$/m)!;
  const at = anchor.index! + anchor[0].length;
  return `${stripped.slice(0, at)}\n- **Let me choose the approach:** ${choose ? "yes" : "no"}${stripped.slice(at)}`;
}
