// The choices the New spec form makes about the spec it creates, beyond
// its text: whether acceptance ticking is required, whether AI formulates
// the acceptance criteria, how strictly analyze checks them, and whether
// the person asks to choose between the approaches analyze finds. Each
// becomes a field on the create job, which `runnerArgv` turns into a flag.

import { parseCriteriaChecks } from "../project/discover";
import type { Job } from "./types.ts";

/** The create job's fields for these choices, or what was refused. */
export type CreateChoices =
  | { fields: Pick<Job, "acceptanceNotRequired" | "createNoAiFormulate" | "createCriteriaChecks" | "createChooseApproach"> }
  | { error: string };

/** A box posts `"1"` when it is ticked and nothing when it is clear. */
const ticked = (value: unknown): boolean => value === "1" || value === true;

export function parseCreateChoices(r: Record<string, unknown>): CreateChoices {
  // Whether this run says acceptance ticking is not required (spec
  // 386). The form posts what it says: ticked means it IS required, and
  // a cleared checkbox sends nothing, so absent is "not required".
  const acceptanceRequired = ticked(r.acceptanceRequired);

  // Whether AI formulates this create's acceptance criteria at all (spec
  // 433) — the same checked-by-default, posts-when-ticked shape as
  // `acceptanceRequired` above, inverted onto the job the same way.
  const aiFormulateAcceptance = ticked(r.aiFormulateAcceptance);
  const criteriaChecks = parseCriteriaChecks(r.criteriaChecks);
  if ("error" in criteriaChecks) return { error: criteriaChecks.error };

  return {
    fields: {
      // Omitted entirely when nothing was chosen: "nothing chosen means
      // no line", all the way down.
      ...(acceptanceRequired ? {} : { acceptanceNotRequired: true }),
      ...(aiFormulateAcceptance ? {} : { createNoAiFormulate: true }),
      ...(criteriaChecks.level ? { createCriteriaChecks: criteriaChecks.level } : {}),
      // Always carried, ticked or not: the spec records WHETHER the box
      // was ticked, so a clear box is a `no` written down, not nothing.
      createChooseApproach: ticked(r.chooseApproach),
    },
  };
}
