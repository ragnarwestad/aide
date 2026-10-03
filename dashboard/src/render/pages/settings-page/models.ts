// Which models each AI offers, as its tab shows them: the shape of one
// reading, the rule that sets it against the model choices, and the block
// the tab draws. Declared here rather than beside the code that reads it,
// for the same reason `ToolCheck` is: `src/render` may not import
// `src/serve`.

import { esc } from "../../ui/html.ts";
import { btn, buttonForm, facts, field, messageSlot } from "../../ui/components";
import { aliasLabel } from "../../ui/components/model-label.ts";
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
  /** Offered by the AI and no choice of it. */
  offered: OfferedModel[];
  /** A choice of the AI that the reading does not offer. */
  gone: { name: string; model: string }[];
}

/** The two lists on an AI's tab, worked out from the reading and the live
 *  choices each time the tab is drawn. */
export function modelLists(
  tool: CheckableTool,
  choices: Record<string, ModelChoice> | undefined,
  reading: ToolModels,
): ModelLists {
  const own = Object.entries(choices ?? {})
    .filter(([, choice]) => choiceOf(tool, choice))
    .map(([name, choice]) => ({ name, model: choiceModel(name, choice) }));
  return {
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

/** The Claude choices with the version each gives, as every picker labels
 *  them: drawn whether or not a reading is in memory, since the version is
 *  kept across a restart and the reading is not. */
function claudeChoices(panel: ModelsPanel): string {
  const names = Object.entries(panel.choices ?? {})
    .filter(([, choice]) => choiceOf("claude", choice))
    .map(([name]) => name);
  if (!names.length) return `<h3>Model choices</h3><p class="muted">No model choice runs on Claude Code.</p>`;
  const option = (name: string) => panel.options?.find((o) => o.name === name);
  return `<h3>Model choices</h3>` + facts(names.map((name) => ({
    label: esc(name),
    value: esc(aliasLabel(name, option(name)?.ranAs, option(name)?.named)),
  })));
}

/** The field a fixed Claude version is added by, typed as its full id. */
function claudeIdForm(): string {
  const input =
    `<input type="text" id="models-add-claude-id-model" name="model" placeholder="claude-opus-4-8" required>`;
  return (
    `<form id="models-add-claude-id" method="post" action="${MODELS_ADD_ROUTE}" class="reloadform">` +
    `<input type="hidden" name="tool" value="claude">` +
    field("Add a fixed version by its full id", input, {
      for: "models-add-claude-id-model",
      actions: btn({ id: "models-add-claude-id-run", ...ADD }),
    }) +
    messageSlot("refused") +
    `</form>`
  );
}

/** What the last press of Check read of the AI's models, against its
 *  choices: nothing at all until a press has read them. */
function readingBlock(tool: CheckableTool, panel: ModelsPanel, readAt: string): string {
  const reading = panel.reading;
  if (!reading) return `<p class="muted">Models not read yet.</p>`;
  if (reading.noSource) {
    return `<p class="muted">The board does not read this AI's models: its command line has no command that lists them.</p>`;
  }
  const read = `<p class="muted small">Models read ${esc(readAt)}</p>`;
  if (reading.error) return read + `<p class="muted">The models could not be read: ${esc(reading.error)}</p>`;
  const lists = modelLists(tool, panel.choices, reading);
  const offered = lists.offered.length
    ? facts(lists.offered.map((m, i) => ({
      label: esc(offeredLabel(tool, m)),
      value: rowForm(MODELS_ADD_ROUTE, `models-add-${tool}-${i}`, { tool, model: m.model }, ADD, m.model),
    })))
    : `<p class="muted">Every model it offers is a choice.</p>`;
  const gone = lists.gone.length
    ? facts(lists.gone.map((c, i) => ({
      label: esc(c.name === c.model ? c.name : `${c.name} (${c.model})`),
      value: rowForm(MODELS_REMOVE_ROUTE, `models-remove-${tool}-${i}`, { name: c.name }, REMOVE, c.name),
    })))
    : `<p class="muted">Every choice is still offered.</p>`;
  return read + `<h3>Offered, not a choice</h3>` + offered + `<h3>A choice it no longer offers</h3>` + gone;
}

/** The models part of an AI's tab. `readAt` is the reading's time as the
 *  tab stamps it. */
export function modelsBlock(tool: CheckableTool, panel: ModelsPanel, readAt: string): string {
  const claude = tool === "claude";
  return (
    (claude ? claudeChoices(panel) : "") +
    readingBlock(tool, panel, readAt) +
    (claude ? claudeIdForm() : "")
  );
}
