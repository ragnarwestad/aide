// A form the page posts itself and then loads again: the spec page's
// Update, Save, banner and Status tab tick, Stop test server, a test
// board's Run, an offered model's Add and a schedule
// entry's Delete. What the press changed is drawn by the server, so the
// page loads again once it has gone through — or goes where the form
// names, when the press took away the page it was on; a refusal stays on
// the page.

import { postForm, writeLine } from "../press.ts";
import { swapPage } from "../page-swap";
import { sameAddress } from "../page-swap/links";

/** The class the page draws such a form with (`FormHook`, `button.ts`). */
export const RELOAD_FORM = "form.reloadform";

export interface ReloadIo {
  reload(): void;
  go(href: string): void;
  line(id: string): Element | null;
}

const browserIo: ReloadIo = {
  reload: () =>
    void swapPage(location.href, { history: "replace", keepScroll: true }),
  go: (href) =>
    void swapPage(href, {
      history: "push",
      keepScroll: sameAddress(href, location.href),
    }),
  line: (id) => document.getElementById(id),
};

/** Posts the form. A refusal goes into the line the form names with
 *  `data-line`, or its own `.refused` line; an answer that changed nothing
 *  leaves its note in the line the form names with `data-note`, instead of
 *  loading the page again. A form with `data-done` goes there on success,
 *  with `{key}` in it replaced by the key the answer names. */
export async function submitReloadForm(
  form: HTMLFormElement,
  event: Event,
  io: ReloadIo = browserIo,
): Promise<void> {
  if (event.defaultPrevented) return;
  event.preventDefault();
  const line =
    (form.dataset.line ? io.line(form.dataset.line) : null) ??
    form.querySelector(".refused");
  const note = form.dataset.note ? io.line(form.dataset.note) : null;
  await postForm(
    form,
    (answer) => {
      if (answer?.changed === false && note) {
        writeLine(line, "");
        writeLine(note, answer.note ?? "");
        return;
      }
      if (form.dataset.done)
        io.go(
          form.dataset.done.replace(
            "{key}",
            encodeURIComponent(answer?.key ?? ""),
          ),
        );
      else io.reload();
    },
    (why) => {
      // A confirm dialog's OK: the refusal is written behind it. A dialog
      // that holds a form of its own keeps it open, with the refusal in it.
      (
        form.closest("dialog.confirmdialog[open]") as HTMLDialogElement | null
      )?.close();
      writeLine(note, "");
      writeLine(line, why);
    },
  );
}
