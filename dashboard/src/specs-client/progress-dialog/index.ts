// The one hold every progress dialog (`render/ui/components/progress-dialog.ts`)
// is kept open by while its press is under way — Close, Reopen, Remove
// project and Deploy — and Close's and Reopen's OK: the dialog stands while
// the press is sent, and once the queue has the job the page goes to the
// Running page with the spec's row open, where the job is followed. While a
// dialog is held, Escape and the browser's own ways of closing it are
// answered here, and nowhere else.

import { postForm, writeLine } from "../press.ts";

export * from "./steps.ts";

/** Everything the press touches outside the form, so a test can stand in. */
export interface ProgressIo {
  go(url: string): void;
  /** `pageshow` with `persisted`: the back/forward cache brought the page
   *  back with its dialog open. */
  onRestore(fn: () => void): void;
}

const browserIo: ProgressIo = {
  go: (url) => {
    location.href = url;
  },
  // `typeof`: the unit harness runs the page script with no window at all.
  onRestore: (fn) => {
    if (typeof window !== "undefined") {
      window.addEventListener("pageshow", (e) => (e as PageTransitionEvent).persisted && fn());
    }
  },
};

/** Whether a dialog is held, kept per dialog so its listeners are attached
 *  once however many times it is held. */
const holds = new WeakMap<object, { held: boolean }>();

/** The dialog's line for a refusal: empty when `why` is. */
function say(dialog: HTMLDialogElement, why: string): void {
  writeLine(dialog.querySelector(".refused"), why);
}

/** Whether `dialog` is held right now. */
export function isStanding(dialog: HTMLDialogElement): boolean {
  return holds.get(dialog)?.held === true;
}

/** Opens `dialog` as a modal, standing, and keeps it open until `release`:
 *  Escape and the browser's own close do nothing meanwhile, and a restore
 *  from the back/forward cache closes it. `release(why)` writes `why` in
 *  the dialog's own line. */
export function standOpen(
  dialog: HTMLDialogElement,
  io: Pick<ProgressIo, "onRestore"> = browserIo,
): { release(why?: string): void } {
  let hold = holds.get(dialog);
  if (!hold) {
    const fresh = { held: false };
    hold = fresh;
    holds.set(dialog, fresh);
    dialog.addEventListener("cancel", (e) => {
      if (fresh.held) e.preventDefault();
    });
    // A browser can close a modal whose cancel was prevented (a second Escape): stand again.
    dialog.addEventListener("close", () => {
      if (fresh.held) dialog.showModal();
    });
    io.onRestore(() => {
      fresh.held = false;
      dialog.removeAttribute("data-standing");
      say(dialog, "");
      dialog.close();
    });
  }
  const mine = hold;
  mine.held = true;
  dialog.setAttribute("data-standing", "");
  say(dialog, "");
  if (!dialog.open) dialog.showModal();
  return {
    release: (why) => {
      mine.held = false;
      dialog.removeAttribute("data-standing");
      if (why !== undefined) say(dialog, why);
    },
  };
}

/** Close's and Reopen's OK. A refusal is written in the dialog, which
 *  stays open with what was typed. */
export async function submitProgress(form: HTMLFormElement, event: Event, io: ProgressIo = browserIo): Promise<void> {
  if (event.defaultPrevented) return;
  event.preventDefault();
  // The dialog holds its posting form.
  const dialog = form.closest("dialog[data-progress-dialog]") as HTMLDialogElement;
  const hold = standOpen(dialog, io);
  await postForm(
    form,
    (answer) => {
      const job = answer?.job;
      // It stands until the Running page has replaced this one.
      io.go(job?.project && job.specFolder ? `/?open=${job.project}/${job.specFolder}` : "/");
    },
    (why) => hold.release(why),
  );
}
