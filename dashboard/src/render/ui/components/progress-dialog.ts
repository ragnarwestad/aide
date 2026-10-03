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
//
// A dialog with steps (Deploy, Close, Reopen) lists them under the heading,
// one line each with its state, in the one step list every such dialog
// shares: Deploy hands its five steps in, Close and Reopen none, and their
// wait adds a line for each step their job's log marks.

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
   *  project); its OK's form is `<id>-form`. `wait` is where Close's and
   *  Reopen's wait goes: any end but a done job to `back`, a done job to
   *  `done` (the script goes to `/` without it). Absent, the dialog opens
   *  standing on its form's submit. */
  ask?: AskParts & { wait?: { back: string; done?: string } };
  /** The steps it lists while it runs, each waiting until the page script
   *  moves it: Deploy's five, or none for a list the script fills. Absent,
   *  the dialog has no list. */
  steps?: { key: string; label: string }[];
  /** Trusted markup under the steps while it runs: Deploy's finished line. */
  body?: string;
  /** `data-*` on the dialog, for a page script to read (Deploy's words). */
  data?: Record<string, string>;
}

/** The step list, its state words as `data-*` for the page script, and the
 *  empty line it clones for a step the log reaches. */
function stepList(lang: Language, steps: { key: string; label: string }[]): string {
  const waiting = t(lang, "dialog.stepWaiting");
  const lines = steps
    .map((s) => `<li data-step="${esc(s.key)}" data-state="waiting">${esc(s.label)} <span class="progressstate">${esc(waiting)}</span></li>`)
    .join("");
  return (
    `<ol class="progresssteps"${dataAttrs({
      waiting,
      running: t(lang, "dialog.stepRunning"),
      done: t(lang, "dialog.stepDone"),
      failed: t(lang, "dialog.stepFailed"),
    })}>${lines}</ol>` +
    `<template data-step-line><li data-state="waiting"><span class="progressstate"></span></li></template>`
  );
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
    `${ask ? " data-asks" : ""}${parts.steps ? " data-steps" : ""}${dataAttrs(parts.data)}>` +
    `<div class="progresspanel">` +
    question +
    `<div data-running-face><h2 class="standingtitle">${esc(capitalizeFirst(parts.title))}</h2>` +
    `${parts.steps ? stepList(lang, parts.steps) : ""}${parts.body ?? ""}</div>` +
    messageSlot("refused") +
    answers +
    `</div></dialog>`
  );
}
