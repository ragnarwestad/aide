// The step list a progress dialog draws while its job runs
// (`progressDialog()`'s `steps`): Deploy moves its five lines one at a
// time, and the wait behind Close and Reopen moves the line of each step
// its job's log marks, in place. The page draws the whole list, waiting;
// only a step the page did not plan gets a line of its own. The state
// words ride on the list as `data-*`.

export type StepState = "waiting" | "running" | "done" | "failed";

/** How long a failed step stays shown before the dialog moves on. */
export const FAILED_STAYS_MS = 2000;

/** A step as the job read route answers it (`GET /api/queue/<id>?marks=1`). */
export interface DrawnStep {
  key: string;
  title: string;
  state: Exclude<StepState, "waiting">;
}

/** Sets one line's state and its state word. */
export function setStepState(list: HTMLElement, li: HTMLElement, state: StepState): void {
  li.dataset.state = state;
  const word = li.querySelector(".progressstate");
  if (word) word.textContent = list.dataset[state] ?? state;
}

/** Draws `steps` into the dialog's list, in order: a step already drawn
 *  keeps its line and only changes state, so a running spinner does not
 *  restart on every poll, and a step the page did not plan (or a list that
 *  could not be planned) gets a line cloned from the dialog's own template,
 *  marked `data-added`. A dialog with no list, or no steps, draws nothing. */
export function drawSteps(dialog: ParentNode | null, steps: DrawnStep[] | undefined): void {
  const list = dialog?.querySelector("ol.progresssteps") as HTMLElement | null | undefined;
  if (!list || !steps) return;
  const template = dialog?.querySelector("template[data-step-line]") as HTMLTemplateElement | null | undefined;
  for (const step of steps) {
    // By `dataset`, not a selector: a key holds spaces and colons.
    let li = [...list.children].find((child) => (child as HTMLElement).dataset.step === step.key) as HTMLElement | undefined;
    if (!li) {
      li = template?.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
      if (!li) continue;
      li.dataset.step = step.key;
      li.setAttribute("data-added", "");
      li.prepend(`${step.title} `);
      list.append(li);
    }
    setStepState(list, li, step.state);
  }
}

/** Puts the dialog's list back as the page drew it: every planned line
 *  waiting, and the lines an earlier job's log added gone. A dialog with no
 *  list does nothing. */
export function resetSteps(dialog: ParentNode | null): void {
  const list = dialog?.querySelector("ol.progresssteps") as HTMLElement | null | undefined;
  if (!list) return;
  for (const li of [...list.children] as HTMLElement[]) {
    if (li.hasAttribute("data-added")) li.remove();
    else setStepState(list, li, "waiting");
  }
}
