// The /schedule page's own client wiring (spec 276): the Enabled
// toggle, the Run-now button, and the live cron-next preview on the
// create/edit form. Unlike the queue list's rows, nothing here is
// swapped from the server on a timer — each control writes straight
// back into the one cell or line it changed, and nothing touches
// `#jobrows`.

/** The Enabled checkbox on a list row: no form, no confirm — the tick
 *  itself is the press (acceptance criterion 14), the same shape
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

/** The Run-now button's carrier form (acceptance criterion 15). The
 *  answer's own job state is written into the row's "Last run" cell —
 *  found by `data-schedule-state` on the same `<tr>` — so the row shows
 *  the new job without a full page navigation or a fetch of the whole
 *  list. */
export async function postScheduleRun(form: HTMLFormElement, fetchImpl: typeof fetch = fetch): Promise<void> {
  const button = form.querySelector("button") as HTMLButtonElement | null;
  const stateCell = form.closest("tr")?.querySelector("[data-schedule-state]") as HTMLElement | null;
  if (button) button.disabled = true;
  try {
    const res = await fetchImpl(form.action, { method: "POST", headers: { accept: "application/json" } });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; job?: { state?: string } } | null;
    if (res.ok && body?.ok && stateCell) stateCell.textContent = body.job?.state ?? "queued";
  } finally {
    if (button) button.disabled = false;
  }
}

const DEBOUNCE_MS = 300;
const timers = new WeakMap<HTMLInputElement, ReturnType<typeof setTimeout>>();

/** What the Cron field's preview writes back: `Next run: <iso>` on a
 *  cron that parses, the server's own error text otherwise — never
 *  both, and never a stale timestamp left over from before the field's
 *  last edit (acceptance criterion 16). */
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
      target.textContent = `Next run: ${body.next}`;
      target.classList.remove("err");
    } else {
      target.textContent = body?.error ?? "not a valid cron expression";
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
