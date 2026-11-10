// The message at the top of the Specs list for each create that ended
// without a spec: which project, which title and why, with a
// way to try again and a way to be rid of it. It is drawn from the record
// `push/failed-creates.ts` keeps, so it outlives the queue's memory of the job.

import { t, type Language } from "../../../i18n";
import { getCreateMessage } from "../../../messages/create/get.ts";
import type { FailedCreate } from "../../../push/failed-creates.ts";
import { esc } from "../../ui/html.ts";
import { btnLink, buttonForm, helpPopover, rowMessage } from "../../ui/components";

/** The address that opens New spec filled in from a failed create. */
export const retryHref = (id: string): string => `/new?retry=${encodeURIComponent(id)}`;

export function renderFailedCreateNotices(records: FailedCreate[], lang: Language): string {
  return records
    .map((r) => {
      const { text } = getCreateMessage(r, lang);
      const detail = r.detail ? helpPopover("more detail", esc(r.detail)) : "";
      const actions =
        detail +
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
