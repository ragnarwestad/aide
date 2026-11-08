// The deploy job's five steps: their keys, their place in the run log and the
// plan the Running page lists. A step's mark is the line `stepMarks` reads
// back from the run log (`--- Step 3 of 5: Restart the service — done`), and
// its key is the place `stepKey()` gives it, so a mark and its planned line
// are one line on the page.

import { t, type Language } from "../../i18n";
import type { PlannedStep } from "../../queue/parse-stream";
import { stepKey } from "../../queue/parse-stream/step-marks.ts";
import { STEP_LABEL } from "../../render/pages/projects-page/deploy-dialog.ts";

/** The steps, in the order they run: the keys of `STEP_LABEL`. */
export const DEPLOY_STEPS = ["fetch", "install", "restart", "wait", "check"] as const;
export type DeployStep = (typeof DEPLOY_STEPS)[number];

const place = (step: DeployStep): string => `${DEPLOY_STEPS.indexOf(step) + 1} of ${DEPLOY_STEPS.length}`;

/** How a step ends in the log. */
export type DeployMark = "started" | "done" | "skipped" | `stopped: ${string}`;

/** The run-log line that marks `step`, in English whatever the reader's language. */
export const deployMark = (step: DeployStep, ending: DeployMark): string =>
  `--- Step ${place(step)}: ${t("en", STEP_LABEL[step]!)} — ${ending}`;

/** The plan the Running page lists for a deploy: every step, waiting. */
export const deployPlan = (lang: Language): PlannedStep[] =>
  DEPLOY_STEPS.map((step) => ({ key: stepKey(place(step), ""), label: t(lang, STEP_LABEL[step]!) }));
