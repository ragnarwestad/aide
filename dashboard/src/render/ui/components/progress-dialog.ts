// The one dialog every step the board shows running stands in: Close,
// Reopen, Remove project and Deploy. It says what it is doing in one
// heading while its job runs, writes a refusal in its own line, and one
// piece of page script keeps it open until the job has settled
// (`standOpen`, specs-client/progress-dialog/).
//
// A step that asks first (Close, Reopen, Remove project) hands it the
// question, drawn by the confirmation's own parts: the dialog shows the
// question and its answers until OK, and only its running face while it
// stands (`data-standing`). A step that asks nothing (Deploy) shows its
// running face from the moment it opens.

import { capitalizeFirst } from "../../../format/error-sentence.ts";
import type { Language } from "../../../i18n";
import { esc } from "../html.ts";
import { dataAttrs } from "./button.ts";
import { askParts, type AskParts } from "./confirm-dialog.ts";
import { messageSlot } from "./message.ts";

export interface ProgressParts {
  /** The dialog's id, the one its ask button names. Deploy's has none: its
   *  script finds it inside its form. */
  id?: string;
  /** What it shows, alone as its heading, while its job runs: "closing…".
   *  Capitalised here. */
  title: string;
  /** The question asked before the step runs (Close, Reopen, Remove
   *  project); its OK's form is `<id>-form`. `wait` is where Close's and
   *  Reopen's wait goes: any end but a done job to `back`, a done job to
   *  `done` (the script goes to `/` without it). Absent, the dialog opens
   *  standing on its form's submit. */
  ask?: AskParts & { wait?: { back: string; done?: string } };
  /** Trusted markup under the heading while it runs: Deploy's list of steps. */
  body?: string;
  /** `data-*` on the dialog, for a page script to read (Deploy's words). */
  data?: Record<string, string>;
}

export function progressDialog(lang: Language, parts: ProgressParts): string {
  const ask = parts.ask;
  const wait = ask?.wait;
  const { question, answers } = ask
    ? askParts(lang, ask, `${parts.id ?? ""}-form`, {
        ...(wait ? { progress: wait.back } : {}),
        ...(wait?.done ? { "progress-done": wait.done } : {}),
      })
    : { question: "", answers: "" };
  return (
    `<dialog class="progressdialog"${parts.id ? ` id="${esc(parts.id)}"` : ""} data-progress-dialog` +
    `${ask ? " data-asks" : ""}${dataAttrs(parts.data)}>` +
    `<div class="progresspanel">` +
    question +
    `<div data-running-face><h2 class="standingtitle">${esc(capitalizeFirst(parts.title))}</h2>${parts.body ?? ""}</div>` +
    messageSlot("refused") +
    answers +
    `</div></dialog>`
  );
}
