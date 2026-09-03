// Every control on this page used to be a plain form POST: the browser
// navigated on the click, so the button froze mid-navigation with
// nothing to say for itself, and the 303 landed on a page whose render
// asks git once per spec — several seconds later, at the top of the
// list, away from the row the reader was watching. Merge was fixed
// first (spec 96); spec 101 gave Run, Cancel and Create the same
// treatment and took the navigation out of the REFUSAL path too.
//
// Same request, same route, same answer; only the waiting and the jump
// are gone. Everything here degrades: without this file the forms still
// submit themselves and the 303 still works, which is why the markup
// stays a real form rather than a button this code has to give meaning
// to.

import { ACTIONS, postForm } from "./press.ts";
import { swapRows } from "./row-swap.ts";
import { showRefusal } from "./tail-actions.ts";
import { NEW_SPEC_FORM } from "./state.ts";

export async function submitAction(event: Event): Promise<void> {
  // A form that cancelled its own submit (an `onsubmit` that returned
  // false) is not ours to post.
  if (event.defaultPrevented) return;
  const form = (event.target as Element | null)?.closest?.(ACTIONS) as HTMLFormElement | null;
  if (!form) return;
  event.preventDefault();
  await postForm(
    form,
    async () => {
      // Now, not on the next five-second tick: the result belongs where
      // the reader already is.
      await swapRows();
    },
    showRefusal,
  );
}

// The New-spec form is the one control that is NOT about a spec that
// exists, and it is bound directly rather than by delegation: it is
// the whole of its own page (spec 121), with no #jobrows around it for
// a delegated listener to hang off.
//
// Its refusal has no row to land on: the spec it named was never made,
// so the server has no `errorSpec` to give and never will. The reason
// goes beside the form that was refused instead — where the reader is
// still looking, and not in a banner above a disclosure that may well
// be shut.
export function formNote(form: HTMLFormElement, text: string): void {
  const slot = form.querySelector(".refused");
  if (slot) slot.textContent = text;
}

// A dependency is resolved inside ONE specs root — `aide-run-spec`
// checks every "Depends on:" entry against the chosen project's own —
// so a chip belonging to another project is not a choice anyone can
// make. The server refuses it either way; this is the half that means
// nobody has to be refused to find out.
//
// Hidden AND disabled, and unticked on the way out: a disabled box posts
// nothing, but a box that stays ticked while out of sight is a choice
// the reader can no longer see they are making.
export function syncDependsOn(): void {
  const form = document.querySelector(NEW_SPEC_FORM);
  if (!form) return;
  const select = form.querySelector("select[name=project]") as HTMLSelectElement | null;
  if (!select) return;
  for (const wrap of form.querySelectorAll("[data-project]")) {
    const el = wrap as HTMLElement;
    const mine = el.getAttribute("data-project") === select.value;
    el.hidden = !mine;
    const box = el.querySelector("input") as HTMLInputElement | null;
    if (!box) continue;
    box.disabled = !mine;
    if (!mine) box.checked = false;
  }
}

// The one control in this file that deliberately NAVIGATES on success,
// against the rule at the top — because this form is a page (spec 121),
// not a panel on one. There is nothing here to put back into a clean
// state and no #jobrows beside it to refresh: the spec that was just
// made is a row on the LIST, and going there to see it is what pressing
// Create asked for. A refusal still answers in place, where what was
// typed is still typed.
export async function submitCreate(form: HTMLFormElement, event: Event): Promise<void> {
  if (event.defaultPrevented) return;
  event.preventDefault();
  await postForm(
    form,
    async () => {
      location.href = "/";
    },
    (why) => formNote(form, why),
  );
}

// The Projects panel (spec 112): an Add form, and one Remove per
// allowlisted project. Bound directly rather than by delegation, and
// for the same reason the New-spec form is — the panel sits OUTSIDE
// #jobrows so a half-typed git URL survives the five-second swap.
//
// No refusal here has a row to land on: an Add names a project that was
// never added, a Remove that failed leaves the project exactly where the
// reader can already see it, and a Settings save that was refused wrote
// nothing. All go into the form's own `.refused` slot, like New spec's.
//
// The Settings page (spec 184) rides on this unchanged: it posts the
// same two fields and gets the same readiness answer back, so saving
// again re-assesses on the page the reader is already standing on.
export async function submitProjectChange(form: HTMLFormElement, event: Event): Promise<void> {
  if (event.defaultPrevented) return;
  event.preventDefault();
  await postForm(
    form,
    async (body) => {
      // Spec 138: an Add that succeeded has something to SAY — whether
      // a run can start in the project just registered, and every
      // reason it cannot. Navigating would throw that away, which is
      // exactly what hid Skjer's missing specs root and dangling
      // default branch until someone pressed Run. So it stays here: on the page Save
      // was pressed, whose Specs root and Worktree links fields are
      // usually what fixes it, and where saving again re-assesses.
      const note = body?.readiness?.note;
      if (note) {
        // In the form's own message slot, which the server renders as a
        // refusal — so the look follows the answer: a project that CAN
        // run must not be reported in the colour of one that cannot.
        const slot = form.querySelector(".refused") as HTMLElement | null;
        if (slot) slot.className = `refused rowmsg ${body?.readiness?.canRun ? "info" : "waiting"}`;
        formNote(form, note);
        return;
      }
      formNote(form, "");
      // A Remove has no such answer, and does what it always did: the
      // forms live on pages of their own (2026-08-19), so it returns to
      // the list it changed, with the reader's own query string (the
      // token rides there).
      location.href = "/projects" + location.search;
    },
    (why) => formNote(form, why),
  );
}

// The typed confirmation, client side: the button is off until the name
// is typed back exactly. The server refuses a mismatch either way —
// this is the half that means nobody has to be refused to find out.
//
// The button is rendered ENABLED and turned off here, never the other
// way round: a button the server rendered `disabled` could not be
// enabled again with script off, and every control on this page is a
// real form that works without it.
export function bindTypedConfirm(form: HTMLFormElement): void {
  const wrap = form.querySelector("[data-confirm]") as HTMLElement | null;
  if (!wrap) return;
  const target = wrap.getAttribute("data-confirm") ?? "";
  const input = wrap.querySelector("input[name=confirm]") as HTMLInputElement | null;
  const button = wrap.querySelector("button") as HTMLButtonElement | null;
  if (!input || !button) return;
  const sync = (): void => void (button.disabled = input.value !== target);
  sync();
  input.addEventListener("input", sync);
}

/** Spec 184: the Add form's two settings, proposed for whichever
 *  checkout is picked. The server works one proposal out per offered
 *  checkout and puts them all on the form, because nothing is picked at
 *  the moment the page is drawn.
 *
 *  Only ever fills a field the reader has not typed in, and never
 *  overwrites what they did type: a proposal is help, and help that
 *  undoes an answer is not help. A checkout with nothing to propose
 *  clears the field back to blank, so the form never shows the previous
 *  pick's answer beside this one's name. */
export function bindProposals(form: HTMLFormElement): void {
  const raw = form.dataset.proposals;
  if (!raw) return;
  let proposals: Record<string, { specsPath: string; worktreeLinks: string }>;
  try {
    proposals = JSON.parse(raw);
  } catch {
    return; // nothing to propose beats a page whose script died
  }
  const picker = form.querySelector('[name="existingPath"]') as HTMLSelectElement | null;
  if (!picker) return;
  const typed = new Set<string>();
  const fields = (["specsPath", "worktreeLinks"] as const).map((name) => {
    const input = form.querySelector(`[name="${name}"]`) as HTMLInputElement | null;
    input?.addEventListener("input", () => void typed.add(name));
    return { name, input };
  });
  picker.addEventListener("change", () => {
    const proposed = proposals[picker.value];
    for (const { name, input } of fields) {
      if (!input || typed.has(name)) continue;
      input.value = proposed?.[name] ?? "";
    }
  });
}

/** The Deploy button (spec 258): a plain POST that fast-forwards the
 *  checkout and re-runs its install. Bound on its own — not through
 *  `submitProjectChange` — because its success means "reload this same
 *  page and show the new drift state," which is neither of that
 *  function's two endings (Add's readiness note, or Remove's navigate to
 *  the list). Not reached through `NEW_SPEC_FORM` either: this form
 *  deliberately does not carry the `newspecform` class. */
export async function submitDeploy(form: HTMLFormElement, event: Event): Promise<void> {
  if (event.defaultPrevented) return;
  event.preventDefault();
  await postForm(
    form,
    async (answer) => {
      // The server answers before it restarts (queue-admin.ts). A reload
      // fired straight away hit the gap and the page read "the request
      // failed" for a deploy that had succeeded (2026-09-03): say what
      // is happening, wait for the service, then reload.
      if (answer?.restarting) {
        formNote(form, "deployed — the dashboard is restarting; this page reloads when it is back");
        await waitForServer();
      }
      location.reload();
    },
    (why) => formNote(form, why),
  );
}

/** Poll the current page until the server answers it again. Exported
 *  with its two effects as parameters so the wait itself is testable. */
export async function waitForServer(
  get: () => Promise<{ ok: boolean }> = () => fetch(location.pathname, { cache: "no-store" }),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  attempts = 120,
): Promise<boolean> {
  // The kickstart itself waits a second, so the first probe would only
  // ever hit the OLD process and read as "back" — wait it out first.
  await sleep(2000);
  for (let n = 0; n < attempts; n++) {
    try {
      if ((await get()).ok) return true;
    } catch {
      // Refused or reset while the service is down: keep waiting.
    }
    await sleep(1500);
  }
  return false;
}
