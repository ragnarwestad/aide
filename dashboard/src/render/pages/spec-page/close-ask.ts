// Close's question, asked in a dialog on the spec page (spec 525). The
// link beside it carries `data-close-ask`; with script the click opens this
// box, without it the link's own `href` reaches the close page, which stays
// the fallback. The box is the dialog `submitProgress` stands behind: on OK
// it shows `.standingtitle` while the job runs, and a refusal is written in
// its `.refused` line.

import { capitalizeFirst } from "../../../format/error-sentence.ts";
import { t, type Language } from "../../../i18n";
import { DESCRIPTION_MAX } from "../../../queue/parse-request.ts";
import { btn, dialogAnswers, field, messageSlot } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { CLOSE_EFFECT, CLOSE_SENTENCE } from "./close-page.ts";
import { specPagePath } from "./tabs.ts";

export function closeAskDialog(project: string, specFolder: string, lang: Language): string {
  const back = specPagePath(project, specFolder);
  const formId = "closeask";
  return (
    `<dialog class="confirmdialog" data-progress-dialog><div class="confirmpanel">` +
    `<h2>Close ${esc(specFolder)}?</h2>` +
    `<h2 class="standingtitle">${esc(capitalizeFirst(t(lang, "shell.overlayClosing")))}</h2>` +
    `<p class="muted">${esc(CLOSE_SENTENCE)} ${esc(CLOSE_EFFECT)}</p>` +
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
