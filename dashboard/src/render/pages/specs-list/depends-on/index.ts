// The Depends on picker on the Running tab's open row: a line after the
// phase lines, in a form of its own that posts to the spec's tracking route
// and is redrawn in place. Its Save and Cancel and the ticks kept across a
// redraw are the page script's (`specs-client/depends-on/`).

import { saveCancelActions } from "../../../ui/components";
import { esc } from "../../../ui/html.ts";
import { dependsOnField } from "../../new-spec-page";
import type { SpecsPageOptions } from "..";
import { groupKey, isArchivedRow, type SpecGroup, type SpecTarget } from "../data-model";
import { LIST_COLUMNS } from "../row-shared.ts";

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

/** The line after an open row's phase lines. Nothing for a record, for a
 *  create whose folder is not there yet, or when there is nothing to offer
 *  or show. While the lead job is queued or running the boxes show the
 *  ticks and cannot be changed: the tracking route refuses a save then. */
export function dependsOnLine(g: SpecGroup, opts: Pick<SpecsPageOptions, "targets" | "archived">): string {
  if (isArchivedRow(g) || !g.named) return "";
  const offer = dependsOnOffer(g, opts);
  const id = dependsOnFormId(g);
  const held = g.lead?.state === "queued" || g.lead?.state === "running";
  const field = dependsOnField(offer.options, new Set(offer.ticked), {
    wide: true,
    locked: offer.locked,
    project: g.project,
    form: id,
    disabled: held,
    actions: held ? "" : saveCancelActions(id),
  });
  if (!field) return "";
  return (
    `<tr class="subrow" data-depends-line="1"><td colspan="${LIST_COLUMNS}">` +
    `<form class="actionform dependsform" id="${esc(id)}" method="post" ` +
    `action="/api/queue/specs/${esc(g.project)}/${esc(g.specFolder)}/tracking">` +
    `<input type="hidden" name="dependsOn" value="">` +
    field +
    `</form></td></tr>`
  );
}
