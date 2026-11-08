// What a press that asks first does once its OK is pressed — Close, Reopen,
// Remove project and Deploy: the question closes, and the page's loading
// cover (render/ui/busy/nav-overlay.ts) stands in its place with the
// dialog's own word ("Deploying…") until the page has moved on. A refusal
// lifts the cover and opens the question again with the reason in its own
// line.

import { postForm, writeLine } from "../press.ts";
import { swapPage } from "../page-swap";

export const COVER = "aide-cover";
export const COVER_DONE = "aide-cover-done";

/** Everything the press touches outside the form, so a test can stand in. */
export interface ProgressIo {
  go(url: string): void;
  cover(note: string): void;
  uncover(): void;
}

const browserIo: ProgressIo = {
  go: (url) => void swapPage(url, { history: "push" }),
  cover: (note) =>
    void document.dispatchEvent(new CustomEvent(COVER, { detail: { note } })),
  uncover: () => void document.dispatchEvent(new Event(COVER_DONE)),
};

/** The dialog's line for a refusal: empty when `why` is. */
function say(dialog: HTMLDialogElement, why: string): void {
  writeLine(dialog.querySelector(".refused"), why);
}

/** Closes the question and covers the page with the dialog's word until
 *  `release`. `release(why)` lifts the cover and asks again with `why` in
 *  the dialog's own line. */
export function coverWhile(
  dialog: HTMLDialogElement,
  io: ProgressIo = browserIo,
): { release(why?: string): void } {
  say(dialog, "");
  if (dialog.open) dialog.close();
  io.cover(dialog.getAttribute("data-cover-note") ?? "");
  return {
    release: (why) => {
      io.uncover();
      if (why === undefined) return;
      say(dialog, why);
      if (!dialog.open) dialog.showModal();
    },
  };
}

/** Close's, Reopen's and Deploy's OK. Once the queue has the job the page
 *  goes to the Running page with the job's row open. */
export async function submitProgress(
  form: HTMLFormElement,
  event: Event,
  io: ProgressIo = browserIo,
): Promise<void> {
  if (event.defaultPrevented) return;
  event.preventDefault();
  // The dialog holds its posting form.
  const dialog = form.closest(
    "dialog[data-progress-dialog]",
  ) as HTMLDialogElement;
  const hold = coverWhile(dialog, io);
  await postForm(
    form,
    (answer) => {
      const job = answer?.job;
      const step = job?.steps?.[job.stepIndex ?? 0];
      io.go(
        job?.project && job.specFolder && step
          ? `/?open=${job.project}/${job.specFolder}:${step}`
          : "/",
      );
    },
    (why) => hold.release(why),
  );
}
