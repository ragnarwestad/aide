// The one dialog every press the board shows under way stands in: Close,
// Reopen, Remove project and the board's Deploy. It says what it is doing in one
// heading while its press is under way, writes a refusal in its own line,
// and one piece of page script keeps it open meanwhile (`standOpen`,
// specs-client/progress-dialog/). Close and Reopen stand only until the
// queue has their job; the Running page follows it from there.
//
// A step hands it the question it asks first, drawn by the confirmation's
// own parts: the dialog shows the question and its answers until OK, and
// only its running face while it stands (`data-standing`).

import { capitalizeFirst } from "../../../format/error-sentence.ts";
import type { Language } from "../../../i18n";
import { esc } from "../html.ts";
import { askParts, type AskParts } from "./confirm-dialog.ts";
import { messageSlot } from "./message.ts";

export interface ProgressParts {
  /** The dialog's id, the one its ask button names. */
  id?: string;
  /** What it shows, alone as its heading, while its job runs: "closing…".
   *  Capitalised here. */
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
    `${ask ? " data-asks" : ""}>` +
    `<div class="progresspanel">` +
    question +
    `<div data-running-face><h2 class="standingtitle">${esc(capitalizeFirst(parts.title))}</h2></div>` +
    messageSlot("refused") +
    answers +
    `</div></dialog>`
  );
}
