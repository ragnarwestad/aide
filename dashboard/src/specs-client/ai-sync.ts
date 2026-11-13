// Keeping a phase line's AI picker and its model select honest with
// each other.

import { postPendingModel } from "./pending-model.ts";
import { postTailModel } from "./tail-actions.ts";
import { chosen, selectKey } from "./state.ts";
import { TOOL_ICONS, toolIcon } from "../page-contract.ts";

// The AI picked on ONE phase line, written into that line's own model
// select. One phase, never the row: the control it replaced
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
// An earlier filter was removed because it was
// ROW-WIDE and hid that a spec can run analyze on one CLI and
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
    const mine = option.value === "" || option.dataset.tool === tool;
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
// The provider picked decides which models the line offers: the ones its
// tool starts. The model stays when it already runs under that tool; else
// it becomes the one the SERVER put on the option (`data-default`): which
// model a provider stands for is a configuration fact, so the browser
// copies it and never chooses between a tool's models itself.
//
// Both picks are recorded in `chosen`. Setting `.value` from script fires
// no `change` event, so the delegated listener that normally remembers a
// hand-made choice never sees the model this writes — and without the
// record the five-second swap would put the server's markup back over the
// phase, with a press afterwards starting the step on a model nobody chose.
export function applyAiPick(select: HTMLSelectElement): void {
  paintProviderFace(select);
  const form = select.getAttribute("form");
  const name = select.getAttribute("data-ai");
  const option = select.selectedOptions[0];
  if (!form || !name || !option) return;
  const model = document.querySelectorAll(
    `select[name="${name}"][form="${form}"]`,
  )[0] as HTMLSelectElement | undefined;
  if (!model) return;
  chosen.set(selectKey(select), select.value);
  const tool = option.dataset.tool;
  if (!tool && option.value === "") {
    model.value = "";
    chosen.set(selectKey(model), "");
    const step = model.name.startsWith("model.") ? model.name.slice("model.".length) : "";
    if (step) void postPendingModel(model, step, "", "");
    return;
  }
  if (tool) offerOnly(model, tool);
  const want = option.dataset.default;
  if (tool && model.selectedOptions[0]?.dataset.tool !== tool && want) {
    for (const o of model.options) {
      if (o.value !== want) continue;
      model.value = want;
      chosen.set(selectKey(model), want);
    }
  }
  // On a LIVE line nothing else would carry this to the server: the write
  // above fires no `change` event, so the running job would go on using
  // the provider and model the row has stopped showing. Called with the
  // value already resolved, never by dispatching a synthetic event.
  if (model.getAttribute("data-post-to")) return void postTailModel(model, model.value, select.value);
  // The same gap on a phase that has NOT run yet: without this the pick
  // would live only in `chosen` — gone the moment the tab closes.
  const step = model.name.startsWith("model.") ? model.name.slice("model.".length) : "";
  if (step) void postPendingModel(model, step, model.value, select.value);
}

/** A face's mark and short name drawn again: the mark from the page
 *  contract's own icons, the short name as text. */
function drawFace(face: Element, tool: string | undefined, short: string | undefined): void {
  face.innerHTML = tool && tool in TOOL_ICONS ? toolIcon(tool as keyof typeof TOOL_ICONS) : "";
  if (!short) return;
  const span = face.ownerDocument.createElement("span");
  span.className = "providershort";
  span.textContent = short;
  face.appendChild(span);
}

/** The face laid over a provider select's own text, kept saying which
 *  provider the select is on: the chosen option's tool and short name, and
 *  its full name as the select's hover text and accessible name. A
 *  provider select with no face (Settings → Models, the schedule form) is
 *  left as it is. */
export function paintProviderFace(select: HTMLSelectElement): void {
  const pick = select.parentElement;
  if (!pick?.classList.contains("providerpick")) return;
  const option = select.selectedOptions[0];
  const face = pick.querySelector(".providerface");
  if (!option || !face) return;
  drawFace(face, option.dataset.tool, option.dataset.short);
  const name = option.textContent ?? "";
  select.setAttribute("title", name);
  select.setAttribute("aria-label", name);
}

/** The compact picker's own box, kept saying what the line is ON (the
 *  pair shown on narrow screens): the provider's face, the model, and the
 *  provider's full name with the model as its title. The two selects
 *  inside it are the truth; this is what stands over them, and a pick
 *  that left it stale would have the reader looking at "sonnet" over a
 *  Codex model until the next redraw. The server draws the same
 *  (`compactAiModel`). */
export function refreshAiModelBox(container: Element): void {
  const modelEl = container.querySelector(".aimodelshort");
  const model = container.querySelector(MODEL_SELECTS) as HTMLSelectElement | null;
  if (!modelEl || !model) return;
  const option = (container.querySelector("select[data-ai]") as HTMLSelectElement | null)?.selectedOptions[0];
  const box = container.querySelector(".aimodelnow");
  const face = box?.querySelector(".providerface");
  if (face) drawFace(face, option?.dataset.tool ?? model.selectedOptions[0]?.dataset.tool, option?.dataset.short);
  modelEl.textContent = model.value;
  box?.setAttribute("title", option ? `${option.textContent ?? ""} · ${model.value}` : model.value);
}
