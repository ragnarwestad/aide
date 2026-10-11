// How strictly `/aide-analyze` checks a spec's acceptance criteria: the
// level chosen on the New spec form, posted with the create, and recorded
// by `aide-run-spec` as the `Acceptance criteria checks:` line in the new
// spec's own `1-description.md`. Analyze reads that line in bash
// (`aide_spec_criteria_checks`); here it is read for the spec's open row,
// and written by its settings' Save until analyze has run.

/** The three levels, in the order the New spec form lists them. */
export const CRITERIA_CHECKS = ["off", "warn", "stop"] as const;

/** How strictly `/aide-analyze` checks a spec's acceptance criteria. */
export type CriteriaChecks = (typeof CRITERIA_CHECKS)[number];

/** A posted level: the level itself, `undefined` for an absent or empty
 *  value (nothing is recorded), or an error for any other value. */
export function parseCriteriaChecks(value: unknown): { level?: CriteriaChecks } | { error: string } {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value === "string" && (CRITERIA_CHECKS as readonly string[]).includes(value)) {
    return { level: value as CriteriaChecks };
  }
  return { error: `invalid acceptance criteria checks: ${String(value)} — choose ${CRITERIA_CHECKS.join(", ")}` };
}

// `[ \t]*`, never `\s*`, for the reason `depends-on.ts` gives: `\s`
// matches a newline.
const LEVEL_LINE = /^[ \t]*-[ \t]*\*\*Acceptance criteria checks:\*\*[ \t]*(.*?)[ \t]*$/m;

/** The value the description's `Acceptance criteria checks:` line holds,
 *  as written, or `null` when the description has no such line. */
export function criteriaChecksIn(text: string): string | null {
  const m = text.replace(/\r\n/g, "\n").match(LEVEL_LINE);
  return m ? m[1]! : null;
}

const LEVEL_LINE_WITH_BREAK = /^[ \t]*-[ \t]*\*\*Acceptance criteria checks:\*\*.*(\n|$)/m;

/** The text with its `Acceptance criteria checks:` line set to `level`,
 *  directly after `- **Created:**`, as `aide_spec_record_criteria_checks`
 *  writes it; `null` when there is no Created line to anchor on. */
export function withCriteriaChecksLine(text: string, level: CriteriaChecks): string | null {
  const stripped = text.replace(/\r\n/g, "\n").replace(LEVEL_LINE_WITH_BREAK, "");
  const created = stripped.match(/^[ \t]*-[ \t]*\*\*Created:\*\*.*$/m);
  if (!created) return null;
  const at = created.index! + created[0].length;
  return `${stripped.slice(0, at)}\n- **Acceptance criteria checks:** ${level}${stripped.slice(at)}`;
}
