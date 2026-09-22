// A phase line unfolded to the model's latest messages (spec 500): the ›
// that opens them and the row that lists them. The state is in the
// address (`?phases=`), like the row's own fold and the criteria's
// (`?checks=`), so it survives the live redraw and works with script off.

import { ICON_CHEVRON, stepLabel } from "../../../ui/components";
import { esc } from "../../../ui/html.ts";
import { t } from "../../../../i18n";
import { specTabPath } from "../../spec-page";
import type { Phase, SpecGroup } from "../data-model";
import { queueHref } from "../filter-bar.ts";
import type { SpecsPageOptions } from "../";
import { phaseKey } from "./keys.ts";
import { LIST_COLUMNS } from "../row-shared.ts";

export { phaseKey, parsePhaseKeys } from "./keys.ts";

/** What the server knows of one phase's messages. */
export interface PhaseMessages {
  /** Oldest first, already escaped: printed as given, never escaped again. */
  messages: string[];
  /** The step's key on the Logs tab (`&step=`), when it has one there. */
  step?: string;
  running: boolean;
}

const unfoldedKeys = (raw: string | undefined): Set<string> => new Set((raw ?? "").split(",").filter(Boolean));

/** Whether this phase has run or is running, by what the line already
 *  knows. A phase that is only queued, or that nothing touched, has no
 *  messages to show. */
export function phaseHasRun(g: SpecGroup, p: Phase): boolean {
  return (
    p.step === "create" ||
    g.done.includes(p.step) ||
    p.fileResult !== undefined ||
    p.timeSpentMs !== undefined ||
    p.attempts.some(
      (a) => (a.results ?? []).some((r) => r.step === p.step) || (a.state !== "queued" && a.state !== "cancelled"),
    )
  );
}

/** The › at the head of a phase line that has run. Adds or removes only
 *  this phase's key and keeps every other part of the view. */
export function phaseMessagesFold(g: SpecGroup, p: Phase, opts: SpecsPageOptions, ran: boolean): string {
  if (!ran) return "";
  const lang = opts.lang ?? "en";
  const key = phaseKey(g.project, g.specFolder, p.step);
  const unfolded = unfoldedKeys(opts.filter?.phases);
  const shut = !unfolded.has(key);
  const next = shut ? [...unfolded, key] : [...unfolded].filter((k) => k !== key);
  const action = t(lang, shut ? "list.foldShow" : "list.foldHide");
  return (
    `<a class="fold${shut ? " shut" : ""}" data-nav href="${queueHref(opts.filter ?? {}, { phases: next.join(",") })}" ` +
    `aria-expanded="${shut ? "false" : "true"}" ` +
    `title="${esc(t(lang, "list.phaseFoldTitle", { action, phase: stepLabel(p.step, lang) }))}">${ICON_CHEVRON}</a>`
  );
}

/** The row under an unfolded phase line, or nothing. */
export function phaseMessagesRow(
  g: SpecGroup,
  p: Phase,
  opts: SpecsPageOptions,
  ran: boolean,
): { tag: string; cells: string } | null {
  if (!ran || !unfoldedKeys(opts.filter?.phases).has(phaseKey(g.project, g.specFolder, p.step))) return null;
  const lang = opts.lang ?? "en";
  const found = opts.phaseMessages?.(
    p.attempts.map((a) => a.id),
    p.step,
  );
  const tab = specTabPath(g.project, g.specFolder, "steps");
  const href = esc(found?.step ? `${tab}&step=${encodeURIComponent(found.step)}` : tab);
  const body = !found
    ? `<p class="phasemsgempty muted">${esc(t(lang, "list.phaseNoneKept"))}</p>`
    : found.messages.length === 0
      ? `<p class="phasemsgempty muted">${esc(t(lang, "list.phaseNoMessages"))}</p>`
      : `<ul class="phasemsglist">${found.messages.map((m) => `<li>${m}</li>`).join("")}</ul>`;
  return {
    tag: `<tr class="phasemsgs" data-msgs="${esc(p.step)}">`,
    cells: `<td colspan="${LIST_COLUMNS}">${body}<a class="phasemsgopen" href="${href}">${esc(t(lang, "list.phaseOpenLog"))}</a></td>`,
  };
}
