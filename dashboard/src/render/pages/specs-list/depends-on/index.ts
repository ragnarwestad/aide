// The Depends on picker on the Running tab's open row, and under it the four
// settings the spec was created with: a line after the phase lines, in a form
// of its own that posts to the spec's tracking route and is redrawn in place.
// Its Save and Cancel and the changes kept across a redraw are the page
// script's (`specs-client/depends-on/`).

import { saveCancelActions } from "../../../ui/components";
import { t } from "../../../../i18n";
import { capitalizeFirst } from "../../../../format/error-sentence.ts";
import { createChoicesIn } from "../../../../project/discover";
import { optionsGroup } from "../../new-spec-page/options-tab.ts";
import { esc } from "../../../ui/html.ts";
import { dependsOnField } from "../../new-spec-page";
import type { SpecsPageOptions } from "..";
import { groupKey, isArchivedRow, type SpecGroup, type SpecTarget } from "../data-model";
import { LIST_COLUMNS } from "../row-shared.ts";
import { specBusy } from "../row-state.ts";

/** The form's id, which its boxes name with `form=` too, so a tick is
 *  remembered per spec across a redraw. */
export const dependsOnFormId = (g: Pick<SpecGroup, "project" | "specFolder">): string =>
  `depends-${g.project}-${g.specFolder}`;

/** What the picker holds: the specs the New spec form offers for the
 *  project, less the spec itself; what the spec depends on now; and the
 *  dependencies since archived or closed, which are not offered but stay
 *  ticked until removed. An entry nothing matches is in neither list. */
export function dependsOnOffer(
  g: SpecGroup,
  opts: Pick<SpecsPageOptions, "targets" | "archived">,
): { options: SpecTarget[]; ticked: string[]; locked: string[] } {
  const options = opts.targets.filter((t) => t.project === g.project && t.specFolder !== g.specFolder);
  const offered = new Set(options.map((t) => t.specFolder));
  const archived = new Set(opts.archived ?? []);
  const locked = g.dependsOn.filter((folder) => !offered.has(folder) && archived.has(groupKey(g.project, folder)));
  return { options, ticked: g.dependsOn, locked };
}

/** The four settings the spec was created with, as New spec's Options tab
 *  draws them: the AI formulation locked, since create has used it, and the
 *  three analyze reads posting with the row's form while `editable`. */
function settingsGroup(g: SpecGroup, id: string, editable: boolean, lang: SpecsPageOptions["lang"] = "en"): string {
  const c = g.createChoices ?? createChoicesIn("");
  return optionsGroup({
    form: id,
    locked: true,
    checksLast: true,
    settingsEditable: editable,
    acceptance: c.acceptanceRequired,
    aiFormulate: c.aiFormulate,
    criteriaChecks: c.criteriaChecks,
    chooseApproach: c.chooseApproach,
    labels: {
      acceptance: capitalizeFirst(t(lang, "spec.acceptanceTickingRequired")),
      aiFormulate: t(lang, "spec.formulateCriteria"),
      criteriaChecks: t(lang, "spec.criteriaChecks"),
      chooseApproach: t(lang, "spec.chooseApproach"),
    },
    levelWords: { off: t(lang, "spec.checksOff"), warn: t(lang, "spec.checksWarn"), stop: t(lang, "spec.checksStop") },
  });
}

/** The line after an open row's phase lines. Nothing for a record or for a
 *  create whose folder is not there yet. While the lead job is queued,
 *  running or landing nothing can be changed, as the phase lines above are
 *  locked then.
 *  The settings take a change only until analyze has run, as the route
 *  allows; Depends on until a job is queued again. */
export function dependsOnLine(g: SpecGroup, opts: Pick<SpecsPageOptions, "targets" | "archived" | "lang">): string {
  if (isArchivedRow(g) || !g.named) return "";
  const offer = dependsOnOffer(g, opts);
  const id = dependsOnFormId(g);
  const held = specBusy(g);
  const actions = held ? "" : saveCancelActions(id);
  const field = dependsOnField(offer.options, new Set(offer.ticked), {
    wide: true,
    locked: offer.locked,
    project: g.project,
    form: id,
    disabled: held,
    actions,
  });
  const settings = settingsGroup(g, id, !held && !g.done.includes("analyze"), opts.lang);
  // With no picker to carry them, Save and Cancel go with the settings.
  const body = field ? field + settings : `<span class="frow options-row">${settings}${actions}</span>`;
  return (
    `<tr class="subrow" data-depends-line="1"><td colspan="${LIST_COLUMNS}">` +
    `<form class="actionform dependsform" id="${esc(id)}" method="post" ` +
    `action="/api/queue/specs/${esc(g.project)}/${esc(g.specFolder)}/tracking">` +
    (field ? `<input type="hidden" name="dependsOn" value="">` : "") +
    body +
    `</form></td></tr>`
  );
}
