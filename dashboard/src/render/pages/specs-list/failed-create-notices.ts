// The message at the top of the Specs list for each create that ended
// without a spec: which project, which title and why, with a
// way to try again and a way to be rid of it. It is drawn from the record
// `push/failed-creates.ts` keeps, so it outlives the queue's memory of the job.

import { t, type Language } from "../../../i18n";
import { MESSAGES } from "../../../i18n/messages.ts";
import { renderSentence, type Sentence } from "../../../i18n/message.ts";
import { stepButton } from "../../../format/step-label.ts";
import type { FailedCreate } from "../../../push/failed-creates.ts";
import { esc } from "../../ui/html.ts";
import { btnLink, buttonForm, helpPopover, rowMessage } from "../../ui/components";

/** The address that opens New spec filled in from a failed create. */
export const retryHref = (id: string): string => `/new?retry=${encodeURIComponent(id)}`;

/** A reason that says to press the create step's button means the New
 *  spec form's own Create, which this message reaches through Try again:
 *  named with the form's label, in the reader's language. */
function withFormButton(s: Sentence, lang: Language): Sentence {
  if (typeof s === "string") return s;
  const inner = s.inner === undefined ? undefined : Array.isArray(s.inner) ? s.inner.map((i) => withFormButton(i, lang)) : withFormButton(s.inner, lang);
  const values = s.values?.button === stepButton("create") ? { ...s.values, button: t(lang, "form.create") } : s.values;
  return { ...s, ...(values ? { values } : {}), ...(inner !== undefined ? { inner } : {}) };
}

type Ending = "full" | "bridge" | "none";

/** What the message adds after the reason: the two presses in full when
 *  the reason says nothing to do, a line saying where Try again leads when
 *  the reason already says to press Create, and nothing when the reason
 *  has advice of its own — a create whose spec was made and not merged
 *  must not be told to make it again. */
function endingFor(r: Sentence | Sentence[] | undefined): Ending {
  if (r === undefined) return "full";
  if (Array.isArray(r)) {
    const each = r.map(endingFor);
    return each.includes("bridge") ? "bridge" : each.length > 0 && each.every((e) => e === "none") ? "none" : "full";
  }
  if (typeof r === "string") return "full";
  if (r.values?.button === stepButton("create")) return "bridge";
  const entry = (MESSAGES as Record<string, { resolve?: string }>)[r.key];
  if (entry?.resolve) return "none";
  return endingFor(r.inner);
}

/** What failed and why, then what to press. */
export function failedCreateText(r: FailedCreate, lang: Language): string {
  const reasons = Array.isArray(r.reason) ? r.reason.map((s) => withFormButton(s, lang)) : withFormButton(r.reason, lang);
  const failed = t(lang, "list.createFailed", {
    project: r.project,
    title: r.title,
    reason: renderSentence(lang, reasons) ?? "",
  });
  const ending = endingFor(r.reason);
  if (ending === "none") return failed;
  const labels = { tryAgain: t(lang, "list.createTryAgain"), create: t(lang, "form.create") };
  const action = t(lang, ending === "full" ? "list.createFailedAction" : "list.createFailedBridge", labels);
  return `${failed}${/[.!?]$/.test(failed) ? "" : "."} ${action}`;
}

export function renderFailedCreateNotices(records: FailedCreate[], lang: Language): string {
  return records
    .map((r) => {
      const text = failedCreateText(r, lang);
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
