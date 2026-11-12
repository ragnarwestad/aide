// The dialog that holds a form's fields: a title, the fields, a line for a
// refusal, and the affirmative and Cancel on one row. The Providers tab's
// Add and the Jobs tab's New group are drawn by it. A button carrying
// `data-ask="<dialog id>"` opens it (`askButton()`, specs-client/ask.ts);
// the page script posts its form by the hook the caller names, and a
// refusal is written in the dialog's own line, which stays open.

import type { Language } from "../../../i18n";
import { esc } from "../html.ts";
import { dataAttrs, saveCancelActions } from "./button.ts";
import { messageSlot } from "./message.ts";

export interface FormDialogParts {
  /** The dialog's id, which its button names. The posting form is
   *  `<id>-form`, the title `<id>-title`, the refusal line `<id>-refused`
   *  and the affirmative `<id>-form-save`. */
  id: string;
  title: string;
  /** Where the form posts, unescaped. */
  action: string;
  /** The class the page script posts the form by. */
  hook: "actionform" | "reloadform";
  /** Each written as `data-<key>` on the posting form. */
  data?: Record<string, string>;
  /** Trusted markup: the form's fields, under the title. */
  fields: string;
  /** The affirmative's own word where it is not Save. */
  save?: { label: string; pending?: string };
  /** Trusted markup between the affirmative and Cancel. */
  between?: string;
}

/** The affirmative is the posting form's first button, the one a press
 *  marks (`postForm`). Cancel submits the empty `method="dialog"` form
 *  after the posting form: the platform's own close, which no field's
 *  validation can stop. */
export function formDialog(lang: Language, parts: FormDialogParts): string {
  const id = esc(parts.id);
  return (
    `<dialog class="formdialog" id="${id}" aria-labelledby="${id}-title">` +
    `<form id="${id}-form" method="post" action="${esc(parts.action)}" class="${parts.hook}"${dataAttrs(parts.data)}>` +
    `<h2 id="${id}-title">${esc(parts.title)}</h2>` +
    parts.fields +
    messageSlot("refused", "failed", { id: `${parts.id}-refused` }) +
    saveCancelActions(`${parts.id}-form`, { save: parts.save, between: parts.between, closes: `${parts.id}-close` }, lang) +
    `</form>` +
    `<form method="dialog" id="${id}-close"></form>` +
    `</dialog>`
  );
}
