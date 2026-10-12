// The step list a progress dialog draws while its job runs
// (`progressDialog()`'s `steps`): Deploy moves its five lines one at a
// time. The page draws the whole list, waiting, and the state words ride on
// the list as `data-*`.

export type StepState = "waiting" | "running" | "done" | "failed";

/** How long a failed step stays shown before the dialog moves on. */
export const FAILED_STAYS_MS = 2000;

/** Sets one line's state and its state word. */
export function setStepState(list: HTMLElement, li: HTMLElement, state: StepState): void {
  li.dataset.state = state;
  const word = li.querySelector(".progressstate");
  if (word) word.textContent = list.dataset[state] ?? state;
}
