// Which models each AI offers, as its tab shows them: the shape of one
// reading, the rule that sets it against the model choices, and the block
// the tab draws. Declared here rather than beside the code that reads it,
// for the same reason `ToolCheck` is: `src/render` may not import
// `src/serve`.

import { esc } from "../../ui/html.ts";
import { buttonForm, facts, messageSlot } from "../../ui/components";
import { aliasLabel } from "../../ui/components/model-label.ts";
import { t, type Language } from "../../../i18n";
import type { ModelChoice } from "../../../queue/types.ts";
import type { CheckableTool } from "./tools.ts";

/** One model an AI offers. `model` is what its command line is given;
 *  `name` is the AI's own name for it, and `id` the model id a Claude
 *  model resolves to today. */
export interface OfferedModel {
  model: string;
  name?: string;
  id?: string;
}

/** One reading of an AI's models, made when its Check was pressed. */
export interface ToolModels {
  tool: CheckableTool;
  /** When the reading was made. Like a check, it is a moment. */
  at: string;
  offered: OfferedModel[];
  /** Claude only: the configured names that are no models of their own
   *  (`opusplan`, the `[1m]` names), with the name and id Claude Code gave
   *  each. Read for the version their choice shows; never offered. */
  named?: OfferedModel[];
  /** Set when the models could not be read. Never shown as none offered. */
  error?: string;
  /** Set for an AI the board has no way to ask. */
  noSource?: boolean;
}

/** What the tab is handed beside the reading: the live choices and the
 *  picker's own options, whose `ranAs` gives a Claude choice its version. */
export interface ModelsPanel {
  reading?: ToolModels;
  choices?: Record<string, ModelChoice>;
  options?: { name: string; tool?: string; ranAs?: string; named?: { id: string; name: string } }[];
}

export const MODELS_ADD_ROUTE = "/api/queue/settings/models/add";
export const MODELS_REMOVE_ROUTE = "/api/queue/settings/models/remove";

const ADD = { label: "Add", pending: "adding…" };
const REMOVE = { label: "Remove", pending: "removing…" };

/** What a choice hands its command line: its own `model`, else its key. */
export const choiceModel = (key: string, choice: ModelChoice): string => choice.model ?? key;

/** Whether a choice runs on `tool`. A stand-in's runs on none of them. */
export const choiceOf = (tool: CheckableTool, choice: ModelChoice): boolean => (choice.tool ?? "claude") === tool;

/** Claude Code takes a model name in any case; Codex and OpenCode do not. */
export const sameModel = (tool: CheckableTool, a: string, b: string): boolean =>
  tool === "claude" ? a.toLowerCase() === b.toLowerCase() : a === b;

export interface ModelLists {
  /** Every choice of the AI: what can be picked on the board today. A
   *  choice the reading no longer offers is still one, until it is removed. */
  supported: { name: string; model: string }[];
  /** Offered by the AI and no choice of it. */
  offered: OfferedModel[];
  /** A choice of the AI that the reading does not offer. */
  gone: { name: string; model: string }[];
}

/** The three lists on an AI's Models tab, worked out from the reading and
 *  the live choices each time the tab is drawn. */
export function modelLists(
  tool: CheckableTool,
  choices: Record<string, ModelChoice> | undefined,
  reading: ToolModels | undefined,
): ModelLists {
  const own = Object.entries(choices ?? {})
    .filter(([, choice]) => choiceOf(tool, choice))
    .map(([name, choice]) => ({ name, model: choiceModel(name, choice) }));
  if (!reading) return { supported: own, offered: [], gone: [] };
  return {
    supported: own,
    offered: reading.offered.filter((m) => !own.some((c) => sameModel(tool, c.model, m.model))),
    gone: own.filter((c) => !reading.offered.some((m) => sameModel(tool, c.model, m.model))),
  };
}

/** A model as its row names it: a Claude model with the version it gives,
 *  another AI's with its own name beside, when that says something more. */
function offeredLabel(tool: CheckableTool, m: OfferedModel): string {
  if (!m.name || m.name === m.model) return m.model;
  return tool === "claude" ? `${m.model} → ${m.name}` : `${m.model} (${m.name})`;
}

/** One row's button, in a form of its own. The id carries the row's
 *  place, since a model name may hold characters an id should not. */
function rowForm(
  action: string,
  id: string,
  hidden: Record<string, string>,
  button: { label: string; pending: string },
  what: string,
): string {
  return buttonForm({
    id,
    action,
    hook: "configactions reloadform",
    hidden,
    button: { id: `${id}-run`, ...button, ariaLabel: `${button.label} ${what}` },
    after: messageSlot("refused"),
  });
}

/** The models that can be picked on the board today: a Claude choice
 *  with the version it gives, as every picker labels it, another AI's with
 *  the model its command line is given. Drawn whether or not a reading is
 *  in memory, since the version is kept across a restart and the reading
 *  is not. */
function supportedBlock(tool: CheckableTool, panel: ModelsPanel, lang: Language, toolName: string): string {
  const heading = `<h3>${esc(t(lang, "settings.models.supported"))}</h3>`;
  const { supported } = modelLists(tool, panel.choices, undefined);
  if (!supported.length) return heading + `<p class="muted">${esc(t(lang, "settings.models.noneSupported", { tool: toolName }))}</p>`;
  const option = (name: string) => panel.options?.find((o) => o.name === name);
  return heading + facts(supported.map(({ name, model }) => ({
    label: esc(name),
    value: esc(tool === "claude" ? aliasLabel(name, option(name)?.ranAs, option(name)?.named) : model),
  })));
}

/** What the last press of the Models tab's Check read of the AI's models,
 *  against its choices: nothing at all until a press has read them. */
function readingBlock(tool: CheckableTool, panel: ModelsPanel, lang: Language): string {
  const reading = panel.reading;
  if (!reading) return `<p class="muted">Models not read yet.</p>`;
  if (reading.noSource) {
    return `<p class="muted">The board does not read this AI's models: its command line has no command that lists them.</p>`;
  }
  if (reading.error) return `<p class="muted">The models could not be read: ${esc(reading.error)}</p>`;
  const lists = modelLists(tool, panel.choices, reading);
  const offered = lists.offered.length
    ? facts(lists.offered.map((m, i) => ({
      label: esc(offeredLabel(tool, m)),
      value: rowForm(MODELS_ADD_ROUTE, `models-add-${tool}-${i}`, { tool, model: m.model }, ADD, m.model),
    })))
    : `<p class="muted">${esc(t(lang, "settings.models.allSupported"))}</p>`;
  const gone = lists.gone.length
    ? facts(lists.gone.map((c, i) => ({
      label: esc(c.name === c.model ? c.name : `${c.name} (${c.model})`),
      value: rowForm(MODELS_REMOVE_ROUTE, `models-remove-${tool}-${i}`, { name: c.name }, REMOVE, c.name),
    })))
    : `<p class="muted">${esc(t(lang, "settings.models.noneGone"))}</p>`;
  return (
    `<h3>${esc(t(lang, "settings.models.available"))}</h3>` + offered +
    `<h3>${esc(t(lang, "settings.models.gone"))}</h3>` + gone
  );
}

/** An AI's Models tab: when its models were last read, the ones that can
 *  be picked, and the reading set against them. `readAt` is the reading's
 *  time as the tab stamps it; `toolName` is the AI's own name. */
export function modelsBlock(
  tool: CheckableTool,
  panel: ModelsPanel,
  readAt: string,
  lang: Language = "en",
  toolName: string = tool,
): string {
  const read = panel.reading && !panel.reading.noSource ? `<p class="muted small">Models read ${esc(readAt)}</p>` : "";
  return read + supportedBlock(tool, panel, lang, toolName) + readingBlock(tool, panel, lang);
}
