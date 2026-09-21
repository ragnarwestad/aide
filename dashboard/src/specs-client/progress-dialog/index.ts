// The wait behind the Reopen and Close confirmation forms: a modal dialog
// opens on submit and stands until the queued job has settled, then the
// page leaves. The dialog has no buttons, so Escape and the browser's
// own ways of closing it are answered here.

import { postForm } from "../press.ts";

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
  onRestore: (fn) => window.addEventListener("pageshow", (e) => (e as PageTransitionEvent).persisted && fn()),
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

export async function submitProgress(form: HTMLFormElement, event: Event, io: ProgressIo = browserIo): Promise<void> {
  if (event.defaultPrevented) return;
  const dialog = form.querySelector("dialog[data-progress-dialog]") as HTMLDialogElement | null;
  // No `<dialog>` here: the form posts natively and follows the redirect.
  if (!dialog || typeof dialog.showModal !== "function") return;
  event.preventDefault();
  const back = form.dataset.progress ?? "/";
  let waiting = true;
  dialog.addEventListener("cancel", (e) => e.preventDefault());
  // A browser can close a modal whose cancel was prevented (a second Escape): stand again.
  dialog.addEventListener("close", () => {
    if (waiting) dialog.showModal();
  });
  io.onRestore(() => {
    waiting = false;
    dialog.close();
  });
  dialog.showModal();
  await postForm(
    form,
    async (answer) => {
      const id = answer?.job?.id;
      const job = id ? await settled(id, io) : undefined;
      waiting = false;
      // The spec page says what a failed job did; the list shows what a done one changed.
      io.go(job?.state === "done" ? "/" : back);
    },
    (why) => {
      waiting = false;
      dialog.close();
      io.go(`${back}?error=${encodeURIComponent(why)}`);
    },
  );
}
