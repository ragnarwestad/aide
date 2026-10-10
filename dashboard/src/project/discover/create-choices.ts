// The four choices New spec's Options tab makes, read off a spec's own
// `1-description.md`. Each comes with the value a spec with nothing
// recorded runs with, so a spec created before a choice was recorded reads
// as the runner treats it. The three lines other than `Acceptance:` are
// written by `aide-run-spec` after a completed create.

import { acceptanceNotRequiredIn } from "./acceptance.ts";
import { chooseApproachIn } from "./choose-approach.ts";
import { CRITERIA_CHECKS, criteriaChecksIn, type CriteriaChecks } from "./criteria-checks.ts";

export interface CreateChoices {
  /** Whether archive waits for the acceptance rows to be ticked. */
  acceptanceRequired: boolean;
  /** Whether an AI session formulated the acceptance criteria on create. */
  aiFormulate: boolean;
  /** How strictly analyze checks the criteria. */
  criteriaChecks: CriteriaChecks;
  /** Whether the person chooses between the approaches analyze finds. */
  chooseApproach: boolean;
}

// `[ \t]*`, never `\s*`, for the reason `depends-on.ts` gives: `\s`
// matches a newline.
const FORMULATE_LINE = /^[ \t]*-[ \t]*\*\*Let AI formulate acceptance criteria:\*\*[ \t]*(.*?)[ \t]*$/m;

/** The four choices in a description's text. A level that is not one of
 *  the three is off, as `invocation.sh` reads it; the AI formulation is
 *  on unless the line says `no`. */
export function createChoicesIn(text: string): CreateChoices {
  const level = criteriaChecksIn(text);
  return {
    acceptanceRequired: !acceptanceNotRequiredIn(text),
    aiFormulate: text.replace(/\r\n/g, "\n").match(FORMULATE_LINE)?.[1] !== "no",
    criteriaChecks: (CRITERIA_CHECKS as readonly (string | null)[]).includes(level) ? (level as CriteriaChecks) : "off",
    chooseApproach: chooseApproachIn(text),
  };
}
