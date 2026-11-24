// The Config tab's Models per phase card: Settings → Models per phase's
// rows, for one project. Each row rests on Board default — the board's own
// choice, named — until the project sets its own, and choosing Board
// default again removes it. A form of its own, like the two settings cards
// above it, posting only its rows to the board's own settings.

import type { QueueDefaults } from "../../../queue/types.ts";
import { boardChoiceFor } from "../../../queue/providers/project-defaults.ts";
import { SIDE_PARTS_OF } from "../../../queue/providers/side-tools.ts";
import { stepLabel } from "../../../format/step-label.ts";
import { t, type Language } from "../../../i18n";
import { btn, cardRow, cardSection, helpPopover, messageSlot } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { OTHER_STEPS, SPEC_STEPS, type SettingsPageOptions } from "../settings-page/index.ts";
import { modelSelect, providerSelect, providerToolOf, resolveChosenModel, resolveProvider, type ProviderOption } from "../../ui/ai-model";

type Tables = Pick<QueueDefaults, "model" | "provider" | "projectModels">;

/** What the card is drawn from: the board's tables and what a picker offers. */
export interface ProjectModelsOptions {
  defaults: Tables;
  modelChoices: SettingsPageOptions["modelChoices"];
  providerChoices: ProviderOption[];
}

/** One row of the card: the project's own choice for the step, or what
 *  Board default rests on while it has none. */
export interface ProjectModelRow {
  step: string;
  /** The step this part sits under, for Review and Verify. */
  under?: string;
  own?: { model: string; provider?: string };
  boardDefault?: { model?: string; provider?: string };
}

/** The card's rows: Settings' steps with their parts under them, in
 *  Settings' order. */
export function projectModelRows(defaults: Tables, project: string): ProjectModelRow[] {
  const own = defaults.projectModels?.[project];
  const row = (step: string, under?: string): ProjectModelRow => {
    const model = own?.model?.[step];
    const base = { step, ...(under ? { under } : {}) };
    return model
      ? { ...base, own: { model, ...(own?.provider?.[step] ? { provider: own.provider[step] } : {}) } }
      : { ...base, boardDefault: boardChoiceFor(defaults, project, step) };
  };
  return [...SPEC_STEPS, ...OTHER_STEPS].flatMap((step) => [row(step), ...(SIDE_PARTS_OF[step] ?? []).map((part) => row(part, step))]);
}

const FORM_ID = "projectsettingsform-models";

/** The card, or nothing on a board that offers no model choice. */
export function projectModelsCard(name: string, o: ProjectModelsOptions | undefined, lang: Language): string {
  const models = o?.modelChoices ?? [];
  if (!o || !models.length) return "";
  const pickerOpts = { modelChoices: models, providerChoices: o.providerChoices };
  const rows = projectModelRows(o.defaults, name).map((r) => {
    const label = r.under ? t(lang, `settings.side.${r.step}` as "settings.side.review") : stepLabel(r.step, lang);
    const board = resolveChosenModel(models, r.boardDefault?.model ?? o.defaults.model.default, undefined);
    const resting = r.own?.model ?? board;
    const defaultProviders = { [r.step]: r.own?.provider ?? r.boardDefault?.provider ?? "" };
    const provider = resolveProvider({ modelChoices: models, providerChoices: o.providerChoices, defaultProviders }, r.step, resting, []);
    const ai = providerSelect({
      name: `provider.${r.step}`, modelName: `model.${r.step}`, form: FORM_ID, opts: pickerOpts, configured: resting,
      chosenProvider: provider?.key, ariaLabel: t(lang, "settings.row.aiAria", { step: label }), wrap: false,
    });
    const model = modelSelect({
      name: `model.${r.step}`, form: FORM_ID, opts: pickerOpts, chosen: r.own?.model,
      boardDefault: {
        label: t(lang, "project.models.boardDefault", { model: board }),
        tool: providerToolOf(models.find((m) => m.name === board)?.tool),
      },
      ariaLabel: t(lang, "settings.row.modelAria", { step: label }),
    });
    return cardRow({
      title: esc(label), ...(r.under ? { sub: stepLabel(r.under, lang) } : {}),
      control: ai + model, data: { step: r.step },
    });
  }).join("");
  const heading = t(lang, "project.models.heading");
  const foot =
    btn({ id: `${FORM_ID}-save`, label: t(lang, "list.checksSave"), variant: "primary", pending: t(lang, "list.checksSaving") }) +
    btn({ id: `${FORM_ID}-cancel`, label: t(lang, "dialog.cancel"), type: "reset" }) +
    messageSlot("refused");
  return (
    `<form id="${FORM_ID}" method="post" action="/api/queue/projects/${esc(encodeURIComponent(name))}/models"` +
    ` class="pageform projectsettingsform" data-actions-id="${FORM_ID}" data-project-models data-dirty-until-saved>` +
    cardSection({ heading, headTrailing: helpPopover(heading, esc(t(lang, "project.models.purpose"))), body: rows, foot }) +
    `</form>`
  );
}
