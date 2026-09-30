// The question every confirmation on the board asks — Close, Reopen,
// Cancel on a list row, Delete on a schedule, Remove project and the
// question before leaving a page with unsaved changes — and the button
// that opens its dialog. A button carrying `data-ask="<dialog id>"` names
// its dialog, and one piece of script opens any of them (`openAsk`,
// specs-client/ask.ts); only the leave question has no button, and is
// opened by the unsaved-changes guard instead.
//
// `confirmDialog()` draws the dialog of a confirmation that runs no step
// of its own: Cancel, Delete and the leave question. Close, Reopen and
// Remove project ask the same question in the progress dialog they then
// stand in (`progress-dialog.ts`), which draws it through `askParts()`.

import { t, type Language } from "../../../i18n";
import { esc } from "../html.ts";
import { btn, buttonForm, type BtnOptions, type FormHook } from "./button.ts";

/** What one question has of its own. Every value is raw: the dialog
 *  escapes each once. */
export interface AskParts {
  title: string;
  sentence?: string;
  /** A field or box under the sentence, tied to the posting form by
   *  `form=` so it is not in the answers row and cannot stop Cancel.
   *  Handed the form's id, escaped. */
  control?: (formId: string) => string;
  /** Every affirmative says OK; `value` is what a `method="dialog"`
   *  answer hands back to the script that opened the dialog. */
  ok: { variant: "primary" | "danger"; pending?: string; value?: string };
  /** Absent: OK closes the dialog with `ok.value` as its answer. */
  post?: {
    action: string;
    /** The class the page script finds the posting form by. */
    hook?: FormHook;
    hidden?: Record<string, string>;
  };
}

export interface ConfirmParts extends AskParts {
  /** The dialog's id, which its button names. The affirmative's form is
   *  always `<id>-form`, whether it posts or only answers the dialog. */
  id: string;
}

/** The question — its heading, its sentence and its control — and the
 *  answers row, with OK's form as `formId`; `data` goes on that form. */
export function askParts(
  lang: Language,
  parts: AskParts,
  formId: string,
  data?: Record<string, string>,
): { question: string; answers: string } {
  const ok: BtnOptions = {
    label: t(lang, "dialog.ok"),
    variant: parts.ok.variant,
    pending: parts.ok.pending,
    value: parts.ok.value,
  };
  const post = parts.post;
  return {
    question:
      `<h2>${esc(parts.title)}</h2>` +
      (parts.sentence ? `<p class="muted">${esc(parts.sentence)}</p>` : "") +
      (parts.control?.(esc(formId)) ?? ""),
    answers: dialogAnswers(
      lang,
      post
        ? buttonForm({ id: formId, action: post.action, hook: post.hook, hidden: post.hidden, data, button: ok })
        : buttonForm({ id: formId, method: "dialog", data, button: ok }),
    ),
  };
}

export function confirmDialog(lang: Language, parts: ConfirmParts): string {
  const { question, answers } = askParts(lang, parts, `${parts.id}-form`);
  return `<dialog class="confirmdialog" id="${esc(parts.id)}"><div class="confirmpanel">${question}${answers}</div></dialog>`;
}

/** The two answers, on one row: `affirmative` (a whole form) first, then
 *  Cancel. Cancel is the platform's own close, a `method="dialog"` form
 *  with no action and no id: it works with no script, and an id ending
 *  `-cancel` would disarm the leave guard (`unsaved-changes.ts`). */
function dialogAnswers(lang: Language, affirmative: string): string {
  return (
    `<div class="dialogactions">${affirmative}` +
    buttonForm({ method: "dialog", button: { label: t(lang, "dialog.cancel") } }) +
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
