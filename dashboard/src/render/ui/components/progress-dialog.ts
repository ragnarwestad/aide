// The one dialog every press that asks first and then runs is drawn by:
// Close, Reopen, Remove project and the board's Deploy. It asks its
// question, and writes a refusal in its own line. Once OK is pressed the
// question closes and the page's loading cover shows the dialog's word
// (`data-cover-note`, "Deploying…") until the page moves on (`coverWhile`,
// specs-client/progress-dialog/).

import { capitalizeFirst } from "../../../format/error-sentence.ts";
import type { Language } from "../../../i18n";
import { esc } from "../html.ts";
import { askParts, type AskParts } from "./confirm-dialog.ts";
import { messageSlot } from "./message.ts";

export interface ProgressParts {
  /** The dialog's id, the one its ask button names. */
  id?: string;
  /** The word the loading cover shows while the press is under way:
   *  "closing…". Capitalised here. */
  title: string;
  /** The question asked before the step runs (Close, Reopen, Remove
   *  project); its OK's form is `<id>-form`. `queuesJob`: its OK queues a
   *  job, and the page goes to the Running page to follow it (Close,
   *  Reopen). Absent, the dialog opens standing on its form's submit. */
  ask?: AskParts & { queuesJob?: boolean };
}

/** A step's state in a step list: the Running page's Close and Reopen lines. */
export type ProgressStepState = "waiting" | "running" | "done" | "failed";

export function progressDialog(lang: Language, parts: ProgressParts): string {
  const ask = parts.ask;
  const { question, answers } = ask
    ? askParts(lang, ask, `${parts.id ?? ""}-form`, ask.queuesJob ? { progress: "" } : {})
    : { question: "", answers: "" };
  return (
    `<dialog class="progressdialog"${parts.id ? ` id="${esc(parts.id)}"` : ""} data-progress-dialog` +
    ` data-cover-note="${esc(capitalizeFirst(parts.title))}">` +
    `<div class="progresspanel">` +
    question +
    messageSlot("refused") +
    answers +
    `</div></dialog>`
  );
}
