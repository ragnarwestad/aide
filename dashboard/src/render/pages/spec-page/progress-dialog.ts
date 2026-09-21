// The dialog the Reopen and Close confirmation forms stand behind while
// their queued job runs. It holds a title and nothing to press: the
// script (`specs-client/progress-dialog.ts`) opens it on submit and
// leaves the page when the job has settled. With no script, or no
// `<dialog>`, it stays closed and the form posts as it always did.

import { capitalizeFirst } from "../../../format/error-sentence.ts";
import { t, type Language } from "../../../i18n";
import type { TranslationKey } from "../../../i18n/translations.ts";
import { esc } from "../../ui/html.ts";

export function progressDialog(lang: Language, titleKey: TranslationKey): string {
  return (
    `<dialog class="confirmdialog" data-progress-dialog><div class="confirmpanel">` +
    `<h2>${esc(capitalizeFirst(t(lang, titleKey)))}</h2>` +
    `</div></dialog>`
  );
}
