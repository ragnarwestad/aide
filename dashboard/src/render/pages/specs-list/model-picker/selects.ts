import { esc } from "../../../ui/html.ts";
import { providerPick } from "../../../ui/components/icons.ts";
import { defaultModelForTool, offeredProviders, shortOf, type PickerOptions, type ProviderOption } from "../model-resolve.ts";
import { modelOptions } from "./index.ts";

export function providerSelect(o: {
  name: string;
  modelName: string;
  form: string;
  opts: PickerOptions;
  configured?: string;
  chosenProvider?: string;
  disabled?: boolean;
  ariaLabel?: string;
  wrap?: boolean;
  removed?: { key: string; tool?: ProviderOption["tool"]; short: string };
}): string {
  const models = o.opts.modelChoices ?? [];
  const providers = o.opts.providerChoices ?? [];
  if (!models.length || !providers.length) return "";
  const resting = providers.find((p) => p.key === o.chosenProvider);
  const offered = offeredProviders(providers, resting?.key);
  const shown = o.removed
    ? { name: o.removed.key, short: o.removed.short, tool: o.removed.tool }
    : (resting ?? offered[0]);
  const select = `<select name="${esc(o.name)}" data-ai="${esc(o.modelName)}" form="${esc(o.form)}"` +
    ` aria-label="${esc(o.ariaLabel ?? shown?.name ?? "")}"` +
    (shown?.name ? ` title="${esc(shown.name)}"` : "") +
    (o.disabled ? " disabled" : "") + `>` +
    (o.removed ? `<option value="${esc(o.removed.key)}"${o.removed.tool ? ` data-tool="${esc(o.removed.tool)}"` : ""}` +
      ` data-short="${esc(o.removed.short)}" selected>${esc(o.removed.key)}</option>` : "") +
    offered.map((p) => `<option value="${esc(p.key)}" data-tool="${esc(p.tool)}"` +
      ` data-default="${esc(defaultModelForTool(models, p.tool, o.configured) ?? "")}"` +
      ` data-short="${esc(shortOf(p))}"${p.key === resting?.key ? " selected" : ""}>${esc(p.name)}</option>`).join("") +
    `</select>`;
  return o.wrap === false ? select : providerPick(select, shown?.tool, shown && shortOf(shown));
}

export function modelSelect(o: {
  name: string;
  form: string;
  opts: PickerOptions;
  chosen?: string;
  disabled?: boolean;
  ariaLabel?: string;
  ranModelId?: string;
  postTo?: string;
  ran?: boolean;
  /** A first option standing for no choice of its own: selected while
   *  `chosen` is absent, and posted empty. It carries the tool of the model
   *  it stands for, so the list is narrowed to that AI's models. */
  boardDefault?: { label: string; tool: string };
}): string {
  return `<select name="${esc(o.name)}" form="${esc(o.form)}"` +
    (o.postTo ? ` data-post-to="${esc(o.postTo)}"` : "") +
    (o.ran ? ` data-ran="1"` : "") +
    (o.ariaLabel ? ` aria-label="${esc(o.ariaLabel)}"` : "") +
    (o.disabled ? " disabled" : "") + `>` +
    (o.boardDefault !== undefined
      ? `<option value="" data-tool="${esc(o.boardDefault.tool)}"${o.chosen === undefined ? " selected" : ""}>${esc(o.boardDefault.label)}</option>`
      : "") +
    modelOptions(o.opts.modelChoices ?? [], o.chosen, o.ranModelId) + `</select>`;
}
