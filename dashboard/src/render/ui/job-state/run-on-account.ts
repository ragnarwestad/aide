// "Run on <account>": the buttons a step stopped on Claude's usage limit
// offers, one for each other Claude account. Every surface that draws the
// stopped step's sentence draws these after it, from the row view's list
// alone; the board worked that list out once (`runOnAccounts`).

import { t, type Language } from "../../../i18n";
import { buttonForm, messageSlot } from "../components";
import type { QueueRowView } from "./types.ts";

/** The route a press posts `{ account }` to. */
export const runOnRoute = (jobId: string): string => `/api/queue/${jobId}/run-on`;

/** One button per account to move to; nothing when the row offers none. */
export function runOnAccountButtons(view: Pick<QueueRowView, "id" | "runOnAccounts">, lang: Language): string {
  return (view.runOnAccounts ?? [])
    .map((account, i) =>
      buttonForm({
        id: `run-on-${view.id}-${i}`,
        action: runOnRoute(view.id),
        hook: "reloadform",
        hidden: { account },
        button: {
          id: `run-on-${view.id}-${i}-run`,
          label: t(lang, "run.onAccount", { account }),
          pending: t(lang, "run.onAccountPending"),
          small: true,
        },
        after: messageSlot("refused"),
      }))
    .join("");
}
