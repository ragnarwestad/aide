// The one dialog Close and Reopen ask their question in, on the spec page
// and over the specs list, with no fallback page behind it: a button
// carrying `data-ask="<dialog id>"` names it, and only script opens it
// (`openAsk`, specs-client/progress-dialog). The box is the dialog
// `submitProgress` stands behind: on OK it shows `.standingtitle` while the
// job runs, and a refusal is written in its `.refused` line.

import { capitalizeFirst } from "../../../format/error-sentence.ts";
import { t, type Language } from "../../../i18n";
import { DESCRIPTION_MAX } from "../../../queue/parse-request.ts";
import { btn, dialogAnswers, field, messageSlot } from "../../ui/components";
import { esc } from "../../ui/html.ts";
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

/** What one ask has of its own. Every value is raw: `askDialog()` escapes
 *  each once. */
export interface AskParts {
  /** The dialog's id, which its button names; the posting form is `<id>-form`. */
  id: string;
  title: string;
  /** The word shown alone while the job runs. */
  standing: string;
  sentence: string;
  /** The control under the sentence, tied to the posting form by `form=`
   *  so it is not in the button row and cannot stop Cancel. Handed the
   *  form's id, escaped. */
  control: (formId: string) => string;
  /** Where OK posts. */
  action: string;
  hidden?: Record<string, string>;
  /** Where any end but a done job goes. */
  back: string;
  /** Where a done job goes; the script goes to `/` when absent. */
  done?: string;
  ok: { variant: "primary" | "danger"; pending: string };
}

export function askDialog(lang: Language, parts: AskParts): string {
  const formId = esc(`${parts.id}-form`);
  const hidden = Object.entries(parts.hidden ?? {})
    .map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`)
    .join("");
  return (
    `<dialog class="confirmdialog" id="${esc(parts.id)}" data-progress-dialog><div class="confirmpanel">` +
    `<h2>${esc(parts.title)}</h2>` +
    `<h2 class="standingtitle">${esc(capitalizeFirst(parts.standing))}</h2>` +
    `<p class="muted">${esc(parts.sentence)}</p>` +
    parts.control(formId) +
    messageSlot("refused") +
    dialogAnswers(
      lang,
      `<form id="${formId}" method="post" action="${esc(parts.action)}" data-progress="${esc(parts.back)}"` +
        (parts.done ? ` data-progress-done="${esc(parts.done)}"` : "") +
        `>` +
        hidden +
        btn({ label: t(lang, "dialog.ok"), variant: parts.ok.variant, pending: parts.ok.pending }) +
        `</form>`,
    ) +
    `</div></dialog>`
  );
}

/** The button that opens the dialog with id `dialogId`. It does nothing
 *  without script, and needs no form: it can sit inside one. */
export function askButton(label: string, dialogId: string, variant?: "primary"): string {
  return `<button type="button" class="btn${variant ? ` ${variant}` : ""}" data-ask="${esc(dialogId)}">${esc(label)}</button>`;
}

export function closeAskDialog(project: string, specFolder: string, lang: Language): string {
  const back = specPagePath(project, specFolder);
  return askDialog(lang, {
    id: CLOSE_ASK_ID,
    title: `Close ${specFolder}?`,
    standing: t(lang, "shell.overlayClosing"),
    sentence: CLOSE_WORDING,
    control: (formId) =>
      field(
        "Reason",
        `<textarea name="reason" form="${formId}" rows="4" required data-maxlength="${DESCRIPTION_MAX}"></textarea>`,
      ),
    action: `/api/queue${back}/close`,
    back,
    ok: { variant: "danger", pending: t(lang, "shell.overlayClosing") },
  });
}

// A line of its own (`.frow`), the box and its words side by side
// (`.row`). Never `.checkbox`: that is the fixed 18px square an
// acceptance row draws, and it squeezed the words into eighteen pixels.
// Unticked: resetting throws the analysis, the plan and the status away.
const resetBox = (formId: string): string =>
  `<div class="frow"><label class="row"><input type="checkbox" name="resetFiles" value="1" form="${formId}">` +
  `<span>Also reset the analysis, the plan and the status</span></label></div>`;

/** Reopen's dialog. `where` says which dialog it is and where the reader
 *  goes once the job is posted: the spec page draws one, the list one per
 *  place a Reopen is pressed, each with the list's own fields in `hidden`
 *  as every form on the list carries them. */
export function reopenAskDialog(
  project: string,
  specFolder: string,
  lang: Language,
  where: { id: string; back: string; done?: string; hidden?: Record<string, string> },
): string {
  return askDialog(lang, {
    id: where.id,
    title: `Reopen ${specFolder}?`,
    standing: t(lang, "list.reopening"),
    sentence: REOPEN_SENTENCE,
    control: resetBox,
    action: "/api/queue",
    hidden: { ...where.hidden, project, specFolder, steps: "reopen" },
    back: where.back,
    done: where.done,
    ok: { variant: "primary", pending: t(lang, "list.reopening") },
  });
}
