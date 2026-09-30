// The one hold every progress dialog (`render/ui/components/progress-dialog.ts`)
// is kept open by while its job runs — Close, Reopen, Remove project and
// Deploy — and the wait behind Close and Reopen: on OK the dialog stands
// until the queued job has settled, then the page leaves. While a dialog
// is held, Escape and the browser's own ways of closing it are answered
// here, and nowhere else.

import { postForm, writeLine } from "../press.ts";

/** A poll a second, at most this many: a modal with no buttons must not
 *  stand for ever behind a job that waits on slow jobs of other specs. */
export const SETTLE_POLLS = 120;
export const SETTLE_EVERY_MS = 1000;

export interface ProgressJob {
  state: string;
  landing?: boolean;
}

/** Everything the wait touches outside the form, so a test can stand in. */
export interface ProgressIo {
  get(url: string): Promise<{ status: number; job?: ProgressJob }>;
  sleep(ms: number): Promise<void>;
  go(url: string): void;
  /** `pageshow` with `persisted`: the back/forward cache brought the page
   *  back with its dialog open. */
  onRestore(fn: () => void): void;
}

const browserIo: ProgressIo = {
  get: async (url) => {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const body = (await res.json().catch(() => null)) as { job?: ProgressJob } | null;
    return { status: res.status, job: body?.job };
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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

/** Polls the job until it is neither queued nor running nor a done job
 *  still landing. Undefined when it gives up: the polls ran out, or the
 *  queue no longer remembers the job. A poll that fails is tried again. */
export async function settled(id: string, io: ProgressIo, attempts = SETTLE_POLLS): Promise<ProgressJob | undefined> {
  for (let i = 0; i < attempts; i++) {
    try {
      const { status, job } = await io.get(`/api/queue/${encodeURIComponent(id)}`);
      if (status === 404) return undefined;
      if (job && job.state !== "queued" && job.state !== "running" && !(job.state === "done" && job.landing)) return job;
    } catch {
      // The server may be restarting: ask again.
    }
    await io.sleep(SETTLE_EVERY_MS);
  }
  return undefined;
}

/** Whether a dialog is held, kept per dialog so its listeners are attached
 *  once however many times it is held. */
const holds = new WeakMap<object, { held: boolean }>();

/** The dialog's line for a refusal: empty when `why` is. */
function say(dialog: HTMLDialogElement, why: string): void {
  writeLine(dialog.querySelector(".refused"), why);
}

/** False for a browser without `<dialog>`: the caller leaves the submit
 *  alone and the form posts natively. */
export function canStand(dialog: HTMLDialogElement | null): dialog is HTMLDialogElement {
  return !!dialog && typeof dialog.showModal === "function";
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

export async function submitProgress(form: HTMLFormElement, event: Event, io: ProgressIo = browserIo): Promise<void> {
  if (event.defaultPrevented) return;
  // The dialog holds its posting form.
  const dialog = form.closest("dialog[data-progress-dialog]") as HTMLDialogElement | null;
  // No `<dialog>` here: the form posts natively and follows the redirect.
  if (!canStand(dialog)) return;
  event.preventDefault();
  const back = form.dataset.progress ?? "/";
  const done = form.dataset.progressDone ?? "/";
  const hold = standOpen(dialog, io);
  await postForm(
    form,
    async (answer) => {
      const id = answer?.job?.id;
      const job = id ? await settled(id, io) : undefined;
      // The spec page says what a failed job did; the list shows what a done
      // one changed. A dialog over the list comes back to it either way. It
      // stands until the next page has replaced this one.
      io.go(job?.state === "done" ? done : back);
    },
    // The dialog stays open with the reason still typed.
    (why) => hold.release(why),
  );
}
