// The one dialog every press the board shows under way stands in: Close,
// Reopen, Remove project and Deploy. It says what it is doing in one
// heading while its press is under way, writes a refusal in its own line,
// and one piece of page script keeps it open meanwhile (`standOpen`,
// specs-client/progress-dialog/). Close and Reopen stand only until the
// queue has their job; the Running page follows it from there.
//
// A step that asks first (Close, Reopen, Remove project) hands it the
// question, drawn by the confirmation's own parts: the dialog shows the
// question and its answers until OK, and only its running face while it
// stands (`data-standing`). A step that asks nothing (Deploy) shows its
// running face from the moment it opens.
//
// Deploy lists its five steps under the heading, one line each with its
// state, in the step list a Close or Reopen also has on its spec's row on
// the Running page (`progressSteps`).

import { capitalizeFirst } from "../../../format/error-sentence.ts";
import { t, type Language } from "../../../i18n";
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
   *  project); its OK's form is `<id>-form`. `queuesJob`: its OK queues a
   *  job, and the page goes to the Running page to follow it (Close,
   *  Reopen). Absent, the dialog opens standing on its form's submit. */
  ask?: AskParts & { queuesJob?: boolean };
  /** The steps it lists while it runs, each waiting until the page script
   *  moves it: Deploy's five. Absent, the dialog has no list. */
  steps?: { key: string; label: string }[];
  /** Trusted markup under the steps while it runs: Deploy's finished line. */
  body?: string;
  /** `data-*` on the dialog, for a page script to read (Deploy's words). */
  data?: Record<string, string>;
}

/** A step's state in a step list. */
export type ProgressStepState = "waiting" | "running" | "done" | "failed";

/** A list of steps, each with its state and state word: a progress
 *  dialog's, and a Close's or Reopen's on its row on the Running page. The
 *  state words ride as `data-*` for the page script that moves a line. */
export function progressSteps(
  lang: Language,
  steps: { key: string; label: string; state?: ProgressStepState }[],
): string {
  const words: Record<ProgressStepState, string> = {
    waiting: t(lang, "dialog.stepWaiting"),
    running: t(lang, "dialog.stepRunning"),
    done: t(lang, "dialog.stepDone"),
    failed: t(lang, "dialog.stepFailed"),
  };
  const lines = steps
    .map((s) => {
      const state = s.state ?? "waiting";
      return `<li data-step="${esc(s.key)}" data-state="${state}">${esc(s.label)} <span class="progressstate">${esc(words[state])}</span></li>`;
    })
    .join("");
  return `<ol class="progresssteps"${dataAttrs(words)}>${lines}</ol>`;
}

export function progressDialog(lang: Language, parts: ProgressParts): string {
  const ask = parts.ask;
  const { question, answers } = ask
    ? askParts(lang, ask, `${parts.id ?? ""}-form`, ask.queuesJob ? { progress: "" } : {})
    : { question: "", answers: "" };
  return (
    `<dialog class="progressdialog"${parts.id ? ` id="${esc(parts.id)}"` : ""} data-progress-dialog` +
    `${ask ? " data-asks" : ""}${parts.steps ? " data-steps" : ""}${dataAttrs(parts.data)}>` +
    `<div class="progresspanel">` +
    question +
    `<div data-running-face><h2 class="standingtitle">${esc(capitalizeFirst(parts.title))}</h2>` +
    `${parts.steps ? progressSteps(lang, parts.steps) : ""}${parts.body ?? ""}</div>` +
    messageSlot("refused") +
    answers +
    `</div></dialog>`
  );
}
