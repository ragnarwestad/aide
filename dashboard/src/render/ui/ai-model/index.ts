// The general AI and model selects every page draws a choice with — the
// specs list's phase lines, the New-spec form, Settings, the schedule form
// and a project's Models card — and the option list the model select draws.

import { esc } from "../html.ts";
import { providerPick } from "../components/icons.ts";
import { aliasLabel, modelName } from "../components/model-label.ts";
import { RUNNABLE_TOOLS, TOOL_NAMES } from "../../../queue/providers/tools.ts";
import { defaultModelForTool, offeredProviders, providerToolOf, shortOf, type AiModelOptions, type ModelChoice, type ProviderOption } from "./options.ts";

export * from "./options.ts";

/** A recorded model no choice names any more: by the version it ran on
 *  where its run reported one, else by the word it was recorded as. */
export function recordLabel(recorded: string, ranModelId: string | undefined): string {
  return modelName(ranModelId) ?? recorded;
}

/** Every configured model, grouped by the CLI it starts.
 *
 *  The grouping is what carries the tool while the list is open, and
 *  the model's own name — `queue-config.json`'s own key — while it is
 *  closed. There is no `(codex)` suffix.
 *
 *  `data-tool` is read to say which tool a model belongs to: the AI select beside this one has to say which
 *  tool the model this select is on belongs to, and after a hand-picked
 *  model survives the five-second swap this attribute is the only place
 *  that fact lives in the browser. It is read to DISPLAY a tool, never
 *  to hide an option — nothing here is hidden by it or by anything
 *  else, which is the next paragraph's whole point.
 *
 *  Nothing is HIDDEN here either, which is the whole point. Every
 *  phase's select offers every model, so a row can be run analyze on
 *  one CLI and implement on another — which the runner has always
 *  allowed and the filter is what stopped anyone discovering.
 *
 *  `RUNNABLE_TOOLS`'s own order, not the configuration's: which group
 *  comes first is a fact about the page, not about whichever tool an
 *  admin happened to list first. A tool with nothing configured draws
 *  no group at all. */
export function modelOptions(
  models: readonly ModelChoice[],
  chosen?: string,
  ranModelId?: string,
): string {
  const groups = RUNNABLE_TOOLS
    .map((tool) => {
      const group = models.filter((m) => (m.tool ?? "claude") === tool);
      if (!group.length) return "";
      return (
        `<optgroup label="${esc(TOOL_NAMES[tool])}">` +
        group
          .map(
            (m) =>
              `<option value="${esc(m.name)}" data-tool="${esc(providerToolOf(tool))}"` +
              // The option's own label is the model's name
              // alone — a per-step dollar figure would read as a price,
              // so the config does not carry one.
              // What the alias gives today, when it has run: `Opus 5.5`.
              `${m.name === chosen ? " selected" : ""}>${esc(aliasLabel(m.name, m.ranAs, m.named))}</option>`,
          )
          .join("") +
        `</optgroup>`
      );
    })
    .join("");
  // An archived phase's own record wins unconditionally
  // (`resolveRecordedModel`), including a model retired or renamed since
  // the run — which no group above lists any more. Rather than let that
  // name silently vanish from the select, one bare option carries it,
  // selected, outside any tool's group.
  const known = chosen !== undefined && models.some((m) => m.name === chosen);
  const stale = chosen && !known ? `<option value="${esc(chosen)}" selected>${esc(recordLabel(chosen, ranModelId))}</option>` : "";
  return groups + stale;
}

export function providerSelect(o: {
  name: string;
  modelName: string;
  form: string;
  opts: Pick<AiModelOptions, "modelChoices" | "providerChoices">;
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
  opts: Pick<AiModelOptions, "modelChoices" | "providerChoices">;
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
