// The message at the top of the Specs list for each create that ended
// without a spec (spec 506): which project, which title and why, with a
// way to try again and a way to be rid of it. It is drawn from the record
// `push/failed-creates.ts` keeps, so it outlives the queue's memory of the job.

import { t, type Language } from "../../../i18n";
import { renderSentence } from "../../../i18n/message.ts";
import type { FailedCreate } from "../../../push/failed-creates.ts";
import { btnLink, buttonForm, rowMessage } from "../../ui/components";

/** The address that opens New spec filled in from a failed create. */
export const retryHref = (id: string): string => `/new?retry=${encodeURIComponent(id)}`;

export function renderFailedCreateNotices(records: FailedCreate[], lang: Language): string {
  return records
    .map((r) => {
      const text = t(lang, "list.createFailed", {
        project: r.project,
        title: r.title,
        reason: renderSentence(lang, r.reason) ?? "",
      });
      const actions =
        btnLink({ href: retryHref(r.id), label: t(lang, "list.createTryAgain"), variant: "primary", small: true }) +
        buttonForm({
          action: `/api/queue/failed-creates/${encodeURIComponent(r.id)}/dismiss`,
          hook: "actionform",
          button: { label: t(lang, "list.createDismiss"), small: true },
        });
      return rowMessage("failed", text, { hook: "failedcreate", actions });
    })
    .join("\n");
}
