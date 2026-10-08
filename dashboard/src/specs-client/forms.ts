// Every control on this page used to be a plain form POST: the browser
// navigated on the click, so the button froze mid-navigation with
// nothing to say for itself, and the 303 landed on a page whose render
// asks git once per spec — several seconds later, at the top of the
// list, away from the row the reader was watching. Merge was fixed
// first (spec 96); spec 101 gave Run, Cancel and Create the same
// treatment and took the navigation out of the REFUSAL path too.
//
// Same request, same route; the answer is JSON, read here, and the
// markup stays a real form so the fields it posts are the form's own.

import { ACTIONS, postForm, writeLine } from "./press.ts";
import { standOpen } from "./progress-dialog";
import { swapRows } from "./row-swap.ts";
import { showRefusal } from "./tail-actions.ts";
import { clearChosenSteps, NEW_SPEC_FORM } from "./state.ts";

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
      // The press has gone through - the row's own hand-made ticks
      // have done their job and must not go on deciding a later run
      // (REQ-2, spec 419).
      clearChosenSteps(form.id);
      // Now, not on the next five-second tick: the result belongs where
      // the reader already is.
      await swapRows();
    },
    (why, spec) => {
      // A row's Cancel is posted from its confirm dialog, and the
      // refusal is written under the row, behind it.
      (form.closest("dialog[open]") as HTMLDialogElement | null)?.close();
      return showRefusal(why, spec);
    },
  );
}

/** The Test servers list's own Stop button (spec 529). Removing the
 *  row instead of navigating is what keeps "← Back" pointed at
 *  whatever page the list itself was opened from — a reload would
 *  recompute it off a Referer that has become this same page. A
 *  refusal says why in the row's own slot and leaves the row where it
 *  is; `postForm()`'s own network-failure fallback (a reload) is
 *  shared with every other button on the board and is not this file's
 *  to change. */
export async function submitTestServerStop(event: Event): Promise<void> {
  if (event.defaultPrevented) return;
  const form = (event.target as Element | null)?.closest?.(ACTIONS) as HTMLFormElement | null;
  if (!form) return;
  event.preventDefault();
  await postForm(
    form,
    async () => {
      form.closest("tr")?.remove();
    },
    (why) => formNote(form, why),
  );
}

// The New-spec form is the one control that is NOT about a spec that
// exists, and it is bound directly rather than by delegation: it is
// the whole of its own page (spec 121), with no #jobrows around it for
// a delegated listener to hang off.
//
// Its refusal has no row to land on: the spec it named was never made,
// so the server has no spec to name and never will. The reason
// goes beside the form that was refused instead — where the reader is
// still looking, and not in a banner above a disclosure that may well
// be shut.
export function formNote(form: HTMLFormElement, text: string): void {
  writeLine(form.querySelector(".refused"), text);
}

/** A Settings save's answer, in the one of the form's two lines it
 *  belongs in: "Defaults saved" in the `notice` line, a refusal in the
 *  `refused` one — and the other emptied, so the page never says both. */
export function settingsAnswer(form: HTMLFormElement, text: string, saved: boolean): void {
  writeLine(form.querySelector(".notice"), saved ? text : "");
  writeLine(form.querySelector(".refused"), saved ? "" : text);
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
      location.href = "/specs";
    },
    (why) => formNote(form, why),
  );
}

// Adding and removing a project: the Add project page's form, and the
// Remove on a project's Config tab. Both are bound directly, like the
// New-spec form.
//
// No refusal here has a row to land on: an Add names a project that was
// never added, and a Remove that failed leaves the project exactly where
// the reader can already see it. An Add's goes into the form's own
// `.refused` slot, like New spec's. Remove asks in a progress dialog,
// which stands while the request is out and takes a refusal in its own
// line.
export async function submitProjectChange(form: HTMLFormElement, event: Event): Promise<void> {
  if (event.defaultPrevented) return;
  event.preventDefault();
  const dialog = form.closest("dialog[data-progress-dialog]") as HTMLDialogElement | null;
  const hold = dialog ? standOpen(dialog) : null;
  await postForm(
    form,
    async (body) => {
      if (!hold) formNote(form, "");
      // The press has done what it was for, and the page goes with it:
      // edits left open beside it (a settings table on the Config tab
      // Remove project sits on) are not a reason to ask before leaving.
      // The guard is a head script with nothing to import, so it hears
      // an event (`unsaved-changes.ts`).
      document.dispatchEvent(new Event("aide-changes-discarded"));
      // An Add lands on the new project's Config tab, which says whether
      // a run can start there and every reason it cannot (spec 138): what
      // hid Skjer's missing specs root until someone pressed Run. A
      // Remove — the press that asks in a dialog — lands on the list the
      // project has left, in the reader's own view; `tab` is the Config
      // tab Remove is pressed on.
      if (!dialog && body?.project) {
        location.href = `/projects/${encodeURIComponent(body.project)}?tab=config`;
        return;
      }
      const params = new URLSearchParams(location.search);
      params.delete("tab");
      const query = params.toString();
      location.href = query ? `/projects?${query}` : "/projects";
    },
    (why) => (hold ? hold.release(why) : formNote(form, why)),
  );
}

// The project page's own Save (spec 486). It used to fall through to
// `submitCreate` by accident — nothing excluded it from `NEW_SPEC_FORM`,
// so it was bound as though it were the New-spec form, and a successful
// save sent the reader to `/` instead of back to their own project. A
// successful save has nothing further to say beyond what the fresh page
// already shows: the new values, the form closed, the readiness
// recomputed — so it goes back to the project's Config tab, dropping
// `?edit=`, and lets the server draw that page as it always does on a
// GET. A refusal stays exactly where every other form's does, in its
// own `.refused` slot.
export async function submitProjectSettings(form: HTMLFormElement, event: Event): Promise<void> {
  if (event.defaultPrevented) return;
  event.preventDefault();
  await postForm(
    form,
    async () => {
      location.href = `${location.pathname}?tab=config`;
    },
    (why) => formNote(form, why),
  );
}


/** A line break, with the space around it, folded to one space. The
 *  server's `oneLine` (`manifest-io.ts`) holds the same expression and
 *  then trims; the bundle imports nothing from outside this folder, so a
 *  test runs both over the same inputs. No trim here: the reader may be
 *  mid-word. */
export function foldLineBreaks(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ");
}

/** The settings table's text fields are textareas, so a long value wraps
 *  instead of scrolling. A textarea does not grow, does not save on
 *  Enter and takes a line break, all of which an `<input>` did; each is
 *  put back here, per field (never the form: a form with no such field
 *  binds nothing, and `window` is touched only when one was found). */
export function bindOneLineFields(form: HTMLFormElement): void {
  const fields = Array.from(form.querySelectorAll("textarea[data-oneline]")) as HTMLTextAreaElement[];
  if (!fields.length) return;
  const fits: (() => void)[] = [];
  for (const field of fields) {
    // From one row every time, which is what lets a field shrink again.
    const fit = () => {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight + ((field.offsetHeight - field.clientHeight) || 0)}px`;
    };
    field.addEventListener("keydown", ((event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      // keyCode 229 is the only sign of an IME keydown Safari sends with isComposing false.
      // noinspection JSDeprecatedSymbols
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (event.repeat) return;
      // A browser skips implicit submission while Save is disabled;
      // `requestSubmit()` does not, so the same condition is read here.
      const save = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
      if (save?.disabled) return;
      form.requestSubmit();
    }) as EventListener);
    field.addEventListener("input", () => {
      if (/[\r\n]/.test(field.value)) {
        const fromEnd = field.value.length - (field.selectionEnd ?? field.value.length);
        field.value = foldLineBreaks(field.value);
        const caret = Math.max(0, field.value.length - fromEnd);
        field.setSelectionRange?.(caret, caret);
      }
      fit();
    });
    fits.push(fit);
    fit();
  }
  window.addEventListener("resize", () => fits.forEach((fit) => fit()));
}
