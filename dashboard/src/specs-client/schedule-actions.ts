// The /schedule page's own client wiring: the Enabled
// toggle, the Run-now button, and the live cron-next preview on the
// create/edit form. Unlike the queue list's rows, nothing here is
// swapped from the server on a timer — each control writes straight
// back into the one cell or line it changed, and nothing touches
// `#jobrows`.

import { isThisPage, type Here } from "./back-link";
import { postForm, refusalText, writeLine, type ActionResult } from "./press.ts";
import { swapPage } from "./page-swap";
import { jobActivity } from "../queue/job-rules/activity.ts";
import { scheduleTrackingKey } from "../project/spec-names.ts";

type ScheduleJob = {
  project?: string;
  specFolder?: string;
  steps?: string[];
  state?: string;
  landing?: boolean;
};

type QueueAnswer = { jobs?: ScheduleJob[] };

const reconcileGeneration = new WeakMap<Document, number>();

function applyScheduleJob(form: HTMLFormElement, job?: ScheduleJob, preserveNewerState = false): void {
  const button = form.querySelector("button") as HTMLButtonElement | null;
  if (!button) return;
  const activity = job ? jobActivity({ state: job.state ?? "", landing: job.landing }) : "idle";
  const state = activity === "queued" || activity === "running" ? activity : "idle";
  if (preserveNewerState && state === "queued" && button.dataset.scheduleState === "running") return;
  button.disabled = state !== "idle";
  button.textContent = form.dataset[state] ?? button.textContent;
  button.dataset.scheduleState = state;
}

function matchingScheduleJob(form: HTMLFormElement, jobs: ScheduleJob[]): ScheduleJob | undefined {
  const key = scheduleTrackingKey(form.dataset.entry ?? "");
  return jobs.find((job) => {
    const activity = jobActivity({ state: job.state ?? "", landing: job.landing });
    return job.project === form.dataset.project &&
      job.specFolder === key &&
      job.steps?.includes("schedule") &&
      (activity === "queued" || activity === "running");
  });
}

/** Bring every Run-now button on the mounted Schedule page in step with
 * the queue. A failed or superseded read leaves the last known state alone. */
export async function reconcileScheduleRuns(doc: Document, fetchImpl: typeof fetch = fetch): Promise<void> {
  const generation = (reconcileGeneration.get(doc) ?? 0) + 1;
  reconcileGeneration.set(doc, generation);
  try {
    const res = await fetchImpl("/api/queue", { headers: { accept: "application/json" } });
    if (!res.ok) return;
    const body = (await res.json().catch(() => null)) as QueueAnswer | null;
    if (!Array.isArray(body?.jobs) || reconcileGeneration.get(doc) !== generation) return;
    for (const el of doc.querySelectorAll("form.schedulerun[data-project][data-entry]")) {
      const form = el as HTMLFormElement;
      applyScheduleJob(form, matchingScheduleJob(form, body.jobs));
    }
  } catch {
    // The next queue event or reconnect tries again; stale state is safer
    // than enabling a control whose job may still be running.
  }
}

/** Reconcile once now and after every queue signal, until this page is replaced. */
export function bindScheduleRuns(doc: Document): () => void {
  const reconcile = (): void => { void reconcileScheduleRuns(doc); };
  reconcile();
  doc.addEventListener("aide:queue-changed", reconcile);
  return () => doc.removeEventListener("aide:queue-changed", reconcile);
}

/** The Enabled checkbox on a list row: no form, no confirm — the tick
 *  itself is the press, the same shape
 *  `postTailStep` gives the queue list's own tail-step chip. Disabled
 *  while the request is out; put back to its old value on a refusal,
 *  left alone on success since the box already shows what was asked
 *  for. */
export async function postScheduleEnabled(box: HTMLInputElement, fetchImpl: typeof fetch = fetch): Promise<void> {
  const to = box.getAttribute("data-post-to") ?? "";
  const wanted = box.checked;
  box.disabled = true;
  try {
    const res = await fetchImpl(to, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ enabled: wanted ? "1" : "0" }),
    });
    if (!res.ok) box.checked = !wanted;
  } catch {
    box.checked = !wanted;
  } finally {
    box.disabled = false;
  }
}

/** The Run-now button's carrier form. It posts
 *  without leaving the page; the entry's Report tab says a run is queued
 *  or running. A refusal, or a request that did not get through, is
 *  written into the page's `.refused` slot, and the next
 *  accepted press empties it again. */
export async function postScheduleRun(form: HTMLFormElement, fetchImpl: typeof fetch = fetch): Promise<void> {
  const button = form.querySelector("button") as HTMLButtonElement | null;
  const slot = form.closest("main")?.querySelector(".refused") as HTMLElement | null;
  const say = (text: string): void => writeLine(slot, text);
  if (button) button.disabled = true;
  let accepted = false;
  try {
    const res = await fetchImpl(form.action, { method: "POST", headers: { accept: "application/json" } });
    const body = (await res.json().catch(() => null)) as ActionResult | null;
    if (res.ok && body?.ok) {
      accepted = true;
      applyScheduleJob(form, body.job as ScheduleJob | undefined, true);
      say("");
    } else {
      say(refusalText(body));
    }
  } catch {
    say(refusalText(null));
  } finally {
    if (button && !accepted) button.disabled = false;
  }
}

/** Save or Create on the page that makes or changes an entry. The
 *  server says where to go next — the page the reader came from — and a
 *  refusal is written into the form's own error line, with everything
 *  typed left where it is. */
export async function submitScheduleForm(
  form: HTMLFormElement,
  event: Event,
  go: (href: string) => void = (href) =>
    leaveAfterSave(href, location, {
      load: (to) => {
        void swapPage(to, { history: "push", keepScroll: true });
      },
      leave: leaveWithoutReferrer,
    }),
): Promise<void> {
  if (event.defaultPrevented) return;
  event.preventDefault();
  const slot = form.querySelector(".refused");
  await postForm(
    form,
    (body) => {
      go(body?.location ?? location.href);
    },
    (why) => writeLine(slot, why),
  );
}

/** Where a save goes on to. Back onto the page the form is on — an
 *  entry's own Settings tab — it is an ordinary load with the page as
 *  Referer, so the page keeps its "← Back" (`back-link/`). Anywhere else
 *  — the page the New form was opened from, a renamed entry's new page —
 *  it leaves without one. */
export function leaveAfterSave(
  href: string,
  here: Here,
  io: { load(href: string): void; leave(href: string): void },
): void {
  if (isThisPage(href, here)) io.load(href);
  else io.leave(href);
}

/** Goes to `href` sending no Referer, the way "← Back" does: the page
 *  a save returns to must not take this form as the page to go back to. */
function leaveWithoutReferrer(href: string): void {
  const link = document.createElement("a");
  link.href = href;
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
}

/** What a click on a schedule row leaves to the control it landed on. */
const ROW_CONTROLS = "a, button, input, select, textarea, label, form, dialog";

/** A click anywhere on a schedule row that is not on one of its controls
 *  opens what the row's name links to (`data-row-href`). A click with a
 *  modifier key is left alone, so the name link still opens a new tab.
 *  Answers where it went, or null. */
export function followScheduleRow(event: MouseEvent, go: (href: string) => void): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target as Element | null;
  if (!target?.closest || target.closest(ROW_CONTROLS)) return null;
  const href = target.closest("tr[data-row-href]")?.getAttribute("data-row-href");
  if (!href) return null;
  go(href);
  return href;
}

const DEBOUNCE_MS = 300;
const timers = new WeakMap<HTMLInputElement, ReturnType<typeof setTimeout>>();

/** What the Cron field's preview writes back: `Next run: <iso>` on a
 *  cron that parses, the server's own error text otherwise — never
 *  both, and never a stale timestamp left over from before the field's
 *  last edit. */
export async function runCronPreview(
  input: HTMLInputElement,
  target: HTMLElement,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const cron = input.value.trim();
  if (!cron) {
    target.textContent = "";
    target.classList.remove("err");
    return;
  }
  try {
    const res = await fetchImpl(`/api/queue/schedule/cron-next?cron=${encodeURIComponent(cron)}`, {
      headers: { accept: "application/json" },
    });
    const body = (await res.json().catch(() => null)) as { next?: string; error?: string } | null;
    if (res.ok && body?.next) {
      target.textContent = (target.dataset?.template ?? "Next run: {at}").replace("{at}", () => body.next!);
      target.classList.remove("err");
    } else {
      target.textContent = target.dataset?.invalid ?? body?.error ?? "not a valid cron expression";
      target.classList.add("err");
    }
  } catch {
    target.textContent = "";
    target.classList.remove("err");
  }
}

/** Debounced entry point for the Cron field's own `input` listener — a
 *  request per keystroke would ask the server to parse a cron string
 *  that is still being typed. `delayMs` is an argument only so a test
 *  can shrink it; production always takes the default. */
export function scheduleCronPreview(
  input: HTMLInputElement,
  target: HTMLElement,
  fetchImpl: typeof fetch = fetch,
  delayMs = DEBOUNCE_MS,
): void {
  const existing = timers.get(input);
  if (existing) clearTimeout(existing);
  timers.set(
    input,
    setTimeout(() => void runCronPreview(input, target, fetchImpl), delayMs),
  );
}
