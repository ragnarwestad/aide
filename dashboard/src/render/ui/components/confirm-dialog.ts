// The one dialog every confirmation on the board asks in — Close, Reopen,
// Cancel on a list row, Delete on a schedule, Remove project and the
// question before leaving a page with unsaved changes — and the button
// that opens it. A button carrying `data-ask="<dialog id>"` names its
// dialog, and one piece of script opens any of them (`openAsk`,
// specs-client/ask.ts); only the leave question has no button, and is
// opened by the unsaved-changes guard instead.
//
// What differs between them is handed in: a control under the sentence,
// a line for a refusal, the word the dialog stands on while its job runs
// (Close and Reopen, which `submitProgress` waits behind), and whether OK
// posts a form or only answers the dialog.

import { capitalizeFirst } from "../../../format/error-sentence.ts";
import { t, type Language } from "../../../i18n";
import { esc } from "../html.ts";
import { btn } from "./button.ts";
import { messageSlot } from "./message.ts";

/** What one confirmation has of its own. Every value is raw: the dialog
 *  escapes each once. */
export interface ConfirmParts {
  /** The dialog's id, which its button names. The affirmative's form is
   *  always `<id>-form`, whether it posts or only answers the dialog. */
  id: string;
  title: string;
  sentence?: string;
  /** A field or box under the sentence, tied to the posting form by
   *  `form=` so it is not in the answers row and cannot stop Cancel.
   *  Handed the form's id, escaped. */
  control?: (formId: string) => string;
  /** A line a refusal is written into (Close, Reopen, Remove project). */
  refusal?: boolean;
  /** The word shown alone while the queued job runs: marks the dialog
   *  `data-progress-dialog` (Close and Reopen). Absent, the dialog never
   *  stands — a list row's Cancel is closed by the row's own redraw. */
  standing?: string;
  /** Every affirmative says OK; `value` is what a `method="dialog"`
   *  answer hands back to the script that opened the dialog. */
  ok: { variant: "primary" | "danger"; pending?: string; value?: string };
  /** Absent: OK closes the dialog with `ok.value` as its answer. */
  post?: {
    action: string;
    /** The class the page script finds the posting form by. */
    hook?: string;
    hidden?: Record<string, string>;
    /** Where Close's and Reopen's wait goes: any end but a done job to
     *  `back`, a done job to `done` (the script goes to `/` without it). */
    progress?: { back: string; done?: string };
    /** The page cover asked for while the request is out. */
    overlay?: string;
  };
}

export function confirmDialog(lang: Language, parts: ConfirmParts): string {
  const formId = esc(`${parts.id}-form`);
  const ok = btn({
    label: t(lang, "dialog.ok"),
    variant: parts.ok.variant,
    pending: parts.ok.pending,
    value: parts.ok.value,
  });
  return (
    `<dialog class="confirmdialog" id="${esc(parts.id)}"${parts.standing ? " data-progress-dialog" : ""}>` +
    `<div class="confirmpanel">` +
    `<h2>${esc(parts.title)}</h2>` +
    (parts.standing ? `<h2 class="standingtitle">${esc(capitalizeFirst(parts.standing))}</h2>` : "") +
    (parts.sentence ? `<p class="muted">${esc(parts.sentence)}</p>` : "") +
    (parts.control?.(formId) ?? "") +
    (parts.refusal ? messageSlot("refused") : "") +
    dialogAnswers(
      lang,
      parts.post
        ? `<form id="${formId}" method="post" action="${esc(parts.post.action)}"${postAttrs(parts.post)}>` +
            hiddenFields(parts.post.hidden) +
            ok +
            `</form>`
        : `<form id="${formId}" method="dialog">${ok}</form>`,
    ) +
    `</div></dialog>`
  );
}

const postAttrs = (post: NonNullable<ConfirmParts["post"]>): string =>
  (post.hook ? ` class="${esc(post.hook)}"` : "") +
  (post.progress ? ` data-progress="${esc(post.progress.back)}"` : "") +
  (post.progress?.done ? ` data-progress-done="${esc(post.progress.done)}"` : "") +
  (post.overlay ? ` data-overlay="${esc(post.overlay)}"` : "");

const hiddenFields = (hidden: Record<string, string> = {}): string =>
  Object.entries(hidden)
    .map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`)
    .join("");

/** The two answers, on one row: `affirmative` (a whole form) first, then
 *  Cancel. Cancel is the platform's own close, a `method="dialog"` form
 *  with no action and no id: it works with no script, and an id ending
 *  `-cancel` would disarm the leave guard (`unsaved-changes.ts`). */
function dialogAnswers(lang: Language, affirmative: string): string {
  return (
    `<div class="dialogactions">${affirmative}` +
    `<form method="dialog">${btn({ label: t(lang, "dialog.cancel") })}</form>` +
    `</div>`
  );
}

/** The button that opens the dialog with id `dialogId`. It does nothing
 *  without script, and needs no form: it can sit inside one. */
export function askButton(o: {
  label: string;
  dialogId: string;
  variant?: "primary" | "danger";
  /** For a button whose label alone does not say what it acts on — one
   *  Delete per schedule entry. */
  ariaLabel?: string;
}): string {
  return btn({ label: o.label, type: "button", variant: o.variant, ariaLabel: o.ariaLabel, data: { ask: o.dialogId } });
}
