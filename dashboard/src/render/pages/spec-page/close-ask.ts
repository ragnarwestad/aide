// Close's question, asked in a dialog on the spec page (spec 525), with no
// fallback page behind it (spec 527): the button beside it carries
// `data-close-ask`, and only script opens this box. The box is the dialog
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

export function closeAskDialog(project: string, specFolder: string, lang: Language): string {
  const back = specPagePath(project, specFolder);
  const formId = "closeask";
  return (
    `<dialog class="confirmdialog" data-progress-dialog><div class="confirmpanel">` +
    `<h2>Close ${esc(specFolder)}?</h2>` +
    `<h2 class="standingtitle">${esc(capitalizeFirst(t(lang, "shell.overlayClosing")))}</h2>` +
    `<p class="muted">${esc(CLOSE_WORDING)}</p>` +
    // The field belongs to the posting form by `form=`, so it is not in the
    // button row and an empty required field cannot stop Cancel.
    field(
      "Reason",
      `<textarea name="reason" form="${formId}" rows="4" required data-maxlength="${DESCRIPTION_MAX}"></textarea>`,
    ) +
    messageSlot("refused") +
    dialogAnswers(
      lang,
      `<form id="${formId}" method="post" action="/api/queue${esc(back)}/close" data-progress="${esc(back)}">` +
        btn({ label: t(lang, "dialog.ok"), variant: "danger", pending: t(lang, "shell.overlayClosing") }) +
        `</form>`,
    ) +
    `</div></dialog>`
  );
}
