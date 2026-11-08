// The message at the top of the Specs list for each create that ended
// without a spec: which project, which title and why, with a
// way to try again and a way to be rid of it. It is drawn from the record
// `push/failed-creates.ts` keeps, so it outlives the queue's memory of the job.

import { t, type Language } from "../../../i18n";
import { MESSAGES } from "../../../i18n/messages.ts";
import { renderMessage, type Sentence } from "../../../i18n/message.ts";
import { stepButton } from "../../../format/step-label.ts";
import type { FailedCreate } from "../../../push/failed-creates.ts";
import { esc } from "../../ui/html.ts";
import {
  btnLink,
  buttonForm,
  helpPopover,
  rowMessage,
} from "../../ui/components";

/** The address that opens New spec filled in from a failed create. */
export const retryHref = (id: string): string =>
  `/new?retry=${encodeURIComponent(id)}`;

/** A reason that says to press the create step's button means the New
 *  spec form's own Create, which this message reaches through Try again:
 *  named with the form's label, in the reader's language. */
function withFormButton(s: Sentence, lang: Language): Sentence {
  if (typeof s === "string") return s;
  const inner =
    s.inner === undefined
      ? undefined
      : Array.isArray(s.inner)
        ? s.inner.map((i) => withFormButton(i, lang))
        : withFormButton(s.inner, lang);
  const values =
    s.values?.button === stepButton("create")
      ? { ...s.values, button: t(lang, "form.create") }
      : s.values;
  return {
    ...s,
    ...(values ? { values } : {}),
    ...(inner !== undefined ? { inner } : {}),
  };
}

/** Whether the reason already says what to do, so the message must not add
 *  the two presses of its own: a create whose spec was made and not merged
 *  must not be told to make it again. A reason that says to press Create
 *  is answered by Try again, which leads to that form. */
function carriesFix(r: Sentence | Sentence[] | undefined): boolean {
  if (r === undefined || typeof r === "string") return false;
  if (Array.isArray(r)) return r.length > 0 && r.every(carriesFix);
  if (r.values?.button === stepButton("create")) return false;
  if (r.values?.solution) return true;
  const entry = (MESSAGES as Record<string, { solution?: unknown }>)[r.key];
  if (entry?.solution) return true;
  return carriesFix(r.inner);
}

/** What failed and why, then what to press. */
export function failedCreateText(r: FailedCreate, lang: Language): string {
  const reasons = Array.isArray(r.reason)
    ? r.reason.map((s) => withFormButton(s, lang))
    : withFormButton(r.reason, lang);
  return renderMessage(lang, {
    key: carriesFix(r.reason) ? "create.failed" : "create.failedTryAgain",
    values: {
      project: r.project,
      title: r.title,
      tryAgain: t(lang, "list.createTryAgain"),
      create: t(lang, "form.create"),
    },
    inner: reasons,
  });
}

export function renderFailedCreateNotices(
  records: FailedCreate[],
  lang: Language,
): string {
  return records
    .map((r) => {
      const text = failedCreateText(r, lang);
      const detail = r.detail ? helpPopover("more detail", esc(r.detail)) : "";
      const actions =
        detail +
        btnLink({
          href: retryHref(r.id),
          label: t(lang, "list.createTryAgain"),
          variant: "primary",
          small: true,
        }) +
        buttonForm({
          action: `/api/queue/failed-creates/${encodeURIComponent(r.id)}/dismiss`,
          hook: "actionform",
          button: { label: t(lang, "list.createDismiss"), small: true },
        });
      return rowMessage("failed", text, { hook: "failedcreate", actions });
    })
    .join("\n");
}
