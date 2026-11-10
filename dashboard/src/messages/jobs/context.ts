/** The step a job is on, or — once it has stopped — the last one it
 *  reached. */
export function currentStep(r: { steps: readonly string[]; stepIndex: number }): string {
  return r.steps[r.stepIndex] ?? r.steps[r.steps.length - 1] ?? "–";
}
