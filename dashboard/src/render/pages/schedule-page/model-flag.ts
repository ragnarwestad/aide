// The flag on a schedule entry naming a model the queue does not offer —
// drawn on the Schedule list and on the entry's own page from one place.
import { t, type Language } from "../../../i18n";
import { listedModelName } from "../../../queue/model-name.ts";
import { rowMessage, rowMessageParts } from "../../ui/components";

/** One sentence: what is wrong and what resolves it. `offered` undefined
 *  means the page was not told what the queue offers, so nothing is drawn;
 *  an empty list means the queue offers none. `href` is the entry's own
 *  page, passed by the list, whose Name link goes to the project's
 *  Schedule tab instead. */
export function modelFlag(
  lang: Language,
  model: string | undefined,
  offered: readonly string[] | undefined,
  href?: string,
): string {
  if (!model || !offered || "name" in listedModelName(offered, model)) return "";
  const text = offered.length
    ? t(lang, "schedule.modelNotOffered", { model, choices: offered.join(", ") })
    : t(lang, "schedule.modelNoneOffered", { model });
  return href ? rowMessageParts("failed", [{ text, href }]) : rowMessage("failed", text);
}
