// How strictly `/aide-analyze` checks a spec's acceptance criteria: the
// level chosen on the New spec form, posted with the create, and recorded
// by `aide-run-spec` as the `Acceptance criteria checks:` line in the new
// spec's own `1-description.md`. Analyze reads that line in bash
// (`aide_spec_criteria_checks`); here it is read only to keep a
// Description Save from changing it.

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
