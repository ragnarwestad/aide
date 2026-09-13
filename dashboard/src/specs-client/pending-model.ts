// A model or AI picked for a phase that has not run yet, posted to the
// server the instant it is made (spec 308) — the non-live sibling of
// `postTailModel()`. Without this the pick lived only in the `chosen`
// map, which is a new, empty object on every page load: leave the page
// and come back, and the picker was back on the default with nothing
// said about it.

import { refusalText, type ActionResult } from "./press.ts";
import { showRefusal } from "./tail-actions.ts";

/** The row a phase select's own `form` attribute names — `rowrun-
 *  <project>/<specFolder>`, the same id `runFormId()` writes server-side
 *  (`row-state.ts`). Parsed rather than carried on the select itself: a
 *  background preference save has nowhere else to read the spec from,
 *  since the pick reaches here well before any Run form is submitted. */
function specFromFormId(formId: string): { project: string; specFolder: string } | null {
  const rest = formId.startsWith("rowrun-") ? formId.slice("rowrun-".length) : "";
  const slash = rest.indexOf("/");
  return slash < 0 ? null : { project: rest.slice(0, slash), specFolder: rest.slice(slash + 1) };
}

/** Posted from the two places a non-live model/AI pick already updates
 *  `chosen`: the delegated `change` listener's plain-select branch, and
 *  `applyAiPick`'s non-live branch. No row-wide lock, unlike
 *  `postTailModel()` — this is a background preference save, not a job
 *  action, and disabling every select on the row for each pick would be
 *  a worse interaction than the one being fixed, since a reader may try
 *  several models in a row before settling on one. */
export async function postPendingModel(select: HTMLSelectElement, step: string, model: string): Promise<void> {
  const formId = select.getAttribute("form") ?? "";
  const spec = specFromFormId(formId);
  if (!spec) return;
  const form = document.querySelector(`form[id="${formId.replace(/["\\]/g, "\\$&")}"]`) as HTMLFormElement | null;
  const token = form?.querySelector('input[name="token"]') as HTMLInputElement | null;
  const url = new URL(`/api/queue/specs/${spec.project}/${spec.specFolder}/model`, location.href);
  if (token?.value) url.searchParams.set("token", token.value);
  const body = new URLSearchParams();
  body.append("step", step);
  body.append("model", model);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const answer = (await res.json().catch(() => null)) as ActionResult | null;
    if (!(res.ok && answer?.ok)) await showRefusal(refusalText(answer), answer?.spec);
  } catch {
    // Best effort: the pick still shows correctly for the rest of THIS
    // page load via the existing `chosen` map; the next hand-made pick
    // tries the write again.
  }
}
