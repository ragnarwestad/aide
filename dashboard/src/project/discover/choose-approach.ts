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
