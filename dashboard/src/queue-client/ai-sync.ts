// Keeping a phase line's AI picker and its model select honest with
// each other (spec 179).

import { postPendingModel } from "./pending-model.ts";
import { postTailModel } from "./tail-actions.ts";
import { chosen, selectKey } from "./state.ts";

// The AI picked on ONE phase line, written into that line's own model
// select (spec 179). One phase, never the row: the control it replaced
// set every phase at once, and a picker that sits on a line is a
// statement about that line.
//
// Which models a phase's select OFFERS: the ones its tool starts, and
// no others. Every model is in the markup — the server draws them all,
// grouped by tool — so switching is a walk over the options here rather
// than a round trip, and a reader with no script keeps the whole list
// exactly as it has always been. That fallback is why this lives in the
// browser and not in the rendering.
//
// Hidden AND disabled: hidden so the list does not offer it, disabled
// so a post cannot carry it even where a browser draws a hidden option
// anyway. The group goes with its options, or the label of an empty
// group would stand over nothing.
//
// Spec 169 had a filter and spec 179's predecessor removed it, because
// it was ROW-WIDE and hid that a spec can run analyze on one CLI and
// implement on another. This one is per PHASE LINE, where the AI select
// lives now, so that capability is untouched.
/** Every model select on a page, whichever page it is: a phase line's
 *  `model.<step>`, and the schedule form's bare `model` — one choice for
 *  the whole entry, since a scheduled job has a single step and no
 *  phases to tell apart. */
export const MODEL_SELECTS = 'select[name="model"], select[name^="model."]';

export function offerEachToItsTool(root: ParentNode): void {
  for (const el of root.querySelectorAll(MODEL_SELECTS)) {
    const model = el as HTMLSelectElement;
    const tool = model.selectedOptions[0]?.dataset.tool;
    if (tool) offerOnly(model, tool);
  }
}

export function offerOnly(model: HTMLSelectElement, tool: string): void {
  // The groups are collected from the options themselves rather than
  // queried for: a group is hidden exactly when every option under it
  // is, and walking up from the options is the one way to know that
  // which asks the select for nothing but its option list.
  const emptied = new Map<HTMLOptGroupElement, boolean>();
  for (const option of Array.from(model.options)) {
    const mine = option.dataset.tool === tool;
    option.hidden = !mine;
    option.disabled = !mine;
    const group = option.parentElement as HTMLOptGroupElement | null;
    if (group?.tagName === "OPTGROUP") {
      emptied.set(group, (emptied.get(group) ?? true) && !mine);
    }
  }
  for (const [group, allHidden] of emptied) group.hidden = allHidden;
}

// Scoped by FORM ID and `data-ai` together, not by walking the row: the
// model selects are written outside their form's own tags and tied to
// it by that attribute alone, so the row is not a container that holds
// them. `data-ai` carries the paired select's `name` — the same name it
// posts under.
//
// The value written is the one the SERVER worked out and put on the
// option. Which model an AI stands for is a configuration fact
// (`defaultModelForTool`, `queue-list.ts`), so the browser copies it
// and never chooses between a tool's models itself.
//
// The write is recorded in `chosen` as well. Setting `.value` from
// script fires no `change` event, so the delegated listener that
// normally remembers a hand-made choice never sees this one — and
// without the record the five-second swap would put the server's markup
// back over the phase this just set, with a press afterwards starting
// the step on a model nobody chose.
//
// Nothing is done to the AI select itself: the browser has already left
// it on the option the reader picked, and a swap puts it back from the
// model select rather than from a memory of its own (`syncAiToModel`).
export function applyAiPick(select: HTMLSelectElement): void {
  const form = select.getAttribute("form");
  const name = select.getAttribute("data-ai");
  const want = select.selectedOptions[0]?.dataset.default;
  if (!form || !name || !want) return;
  const model = document.querySelectorAll(
    `select[name="${name}"][form="${form}"]`,
  )[0] as HTMLSelectElement | undefined;
  if (!model) return;
  offerOnly(model, select.value);
  for (const option of model.options) {
    if (option.value !== want) continue;
    model.value = want;
    chosen.set(selectKey(model), want);
  }
  // Spec 225: on a LIVE line nothing else would carry this to the
  // server. The write above fires no `change` event — deliberately, for
  // the reason the comment on this function gives — so the delegated
  // listener never sees it, and the running job would go on using the
  // model the row has stopped showing. Called with the value already
  // resolved, never by dispatching a synthetic event.
  if (model.getAttribute("data-post-to")) return void postTailModel(model, want);
  // Spec 308: the same gap on a phase that has NOT run yet. The write
  // above fires no `change` event either way, so without this the pick
  // would live only in `chosen` — gone the moment the tab closes — and
  // a reader returning to the spec would find the picker back on the
  // default with nothing said about it.
  const step = model.name.startsWith("model.") ? model.name.slice("model.".length) : "";
  if (step) void postPendingModel(model, step, want);
}

// The other direction, and the only one the AI select is ever written
// in (spec 179): what a phase runs on is one value on the job, and the
// tool is DERIVED from it.
//
// Called from two places, for the two ways a model select can end up on
// something the AI select beside it does not say. After a swap, because
// `restoreChosen` puts a hand-picked model back over the server's fresh
// markup and the AI select in that markup was drawn for the model the
// server chose. And on a live change, because a reader may go straight
// to the model select and ignore the picker beside it — leaving the
// line reading "Claude Code" over a Codex model until the next swap
// came round to fix it.
//
// The tool is read off the model option's own `data-tool`, which is the
// only place that fact lives in the browser.
export function syncAiToModel(model: HTMLSelectElement): void {
  const form = model.getAttribute("form");
  const tool = model.selectedOptions[0]?.dataset.tool;
  if (!form || !tool) return;
  const ai = document.querySelectorAll(
    `select[data-ai="${model.name}"][form="${form}"]`,
  )[0] as HTMLSelectElement | undefined;
  if (!ai) return;
  for (const option of ai.options) {
    if (option.value === tool) ai.value = tool;
  }
}

/** The compact picker's own box, kept saying what the line is ON (spec
 *  179's pair, narrow screens). The two selects inside it are the
 *  truth; this is the one line of text over them, and a pick that left
 *  it stale would have the reader looking at "Claude/sonnet" over a
 *  Codex model until the next redraw.
 *
 *  The AI's word comes off the option the server wrote it on
 *  (`data-short`) — which word stands for which tool is a fact about
 *  the page — and the model is the select's own value. */
export function refreshAiModelBox(container: Element): void {
  const box = container.querySelector(".aimodelnow");
  const model = container.querySelector(MODEL_SELECTS) as HTMLSelectElement | null;
  if (!box || !model) return;
  const ai = container.querySelector("select[data-ai]") as HTMLSelectElement | null;
  const short =
    ai?.selectedOptions[0]?.dataset.short ?? model.selectedOptions[0]?.dataset.tool ?? "";
  const text = short ? `${short}/${model.value}` : model.value;
  box.textContent = text;
  box.setAttribute("title", text);
}
