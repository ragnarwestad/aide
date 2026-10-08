// What Close and Reopen ask, on the spec page and over the specs list,
// with no fallback page behind either: their words, their controls and
// where their wait goes. The dialog itself is the board's one
// `progressDialog()`, which asks their question and then stands while
// their job runs (`submitProgress`), listing the steps the job's log
// marks, a refusal or a failed job's reason written in its own line.

import { t, type Language } from "../../../i18n";
import { DESCRIPTION_MAX } from "../../../queue/parse-request.ts";
import { field, labelledCheckbox, progressDialog } from "../../ui/components";
import { specPagePath } from "./tabs.ts";

/** The one sentence stated wherever a reader meets Close (REQ-2): in this
 *  dialog's own body text, and again — via `overview.ts`'s `actionsHelp` —
 *  beside the control on the spec's own page. One string, so the two places
 *  can never say it differently. */
export const CLOSE_SENTENCE =
  "Close says this spec will not work and archives it as a record; another round is how a spec that is still worth doing goes on.";

/** What Close does to the spec's files and its code branch, said in the
 *  dialog and beside the button with the same words. */
export const CLOSE_EFFECT =
  "Closing merges this spec's files into archive/ as the record, and deletes its code branch (never merges it) — none of that work will be used.";

// AC-4: joined once, here — closeAskDialog() and overview.ts's actionsHelp()
// each read a value already assembled, neither concatenates it itself.
const CLOSE_WORDING = `${CLOSE_SENTENCE} ${CLOSE_EFFECT}`;

/** What Reopen does, said in its dialog above the box that changes it. */
export const REOPEN_SENTENCE =
  "Reopen takes this spec back into the active list for another round. It keeps the description, " +
  "the analysis, the plan and the status as they are, and removes its old branch. " +
  "Tick the box to start the round from a clean slate instead.";

/** Close's dialog, and Reopen's on the spec page: one of each per page. */
export const CLOSE_ASK_ID = "closeask";
export const REOPEN_ASK_ID = "reopenask";

export function closeAskDialog(project: string, specFolder: string, lang: Language): string {
  const back = specPagePath(project, specFolder);
  return progressDialog(lang, {
    id: CLOSE_ASK_ID,
    title: t(lang, "dialog.closing"),
    // Filled by the wait as the job's log marks its steps.
    steps: [],
    ask: {
      title: `Close ${specFolder}?`,
      sentence: CLOSE_WORDING,
      control: (formId) =>
        field(
          "Reason",
          `<textarea name="reason" form="${formId}" rows="4" required data-maxlength="${DESCRIPTION_MAX}"></textarea>`,
        ),
      ok: { variant: "danger", pending: t(lang, "dialog.closing") },
      post: { action: `/api/queue${back}/close` },
      wait: { back, done: "/specs" },
    },
  });
}

// A line of its own (`.frow`). Unticked: resetting throws the analysis,
// the plan and the status away. `formId` is raw: the box escapes it.
const resetBox = (formId: string): string =>
  `<div class="frow">` +
  labelledCheckbox({
    label: "Also reset the analysis, the plan and the status",
    name: "resetFiles",
    value: "1",
    form: formId,
  }) +
  `</div>`;

/** Reopen's dialog. `where` says which dialog it is and where the reader
 *  goes once the job is posted: the spec page draws one, the list one per
 *  place a Reopen is pressed. */
export function reopenAskDialog(
  project: string,
  specFolder: string,
  lang: Language,
  where: { id: string; back: string; done?: string },
): string {
  return progressDialog(lang, {
    id: where.id,
    title: t(lang, "list.reopening"),
    steps: [],
    ask: {
      title: `Reopen ${specFolder}?`,
      sentence: REOPEN_SENTENCE,
      control: () => resetBox(`${where.id}-form`),
      ok: { variant: "primary", pending: t(lang, "list.reopening") },
      post: {
        action: "/api/queue",
        hidden: { project, specFolder, steps: "reopen" },
      },
      wait: { back: where.back, done: where.done },
    },
  });
}
