// Keeping a phase line's AI picker and its model select honest with
// each other.

import { postPendingModel } from "./pending-model.ts";
import { postTailModel } from "./tail-actions.ts";
import { chosen, selectKey } from "./state.ts";

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
  syncSidePickers(root);
}

/** Review and Verify may use Implement's tool or Codex. All configured
 * options stay in the DOM so changing Implement can reveal the new set. */
export function syncSidePickers(root: ParentNode, formId?: string): void {
  for (const el of root.querySelectorAll("select[data-side-picker]")) {
    const select = el as HTMLSelectElement;
    const form = select.getAttribute("form") ?? "";
    if (formId && form !== formId) continue;
    const implement = root.querySelector(`select[name="model.implement"][form="${form}"]`) as HTMLSelectElement | null;
    const tool = implement ? Array.from(implement.options).find((option) => option.value === implement.value)?.dataset.tool : undefined;
    if (!tool) continue;
    const allowed = new Set(tool === "codex" ? ["codex"] : [tool, "codex"]);
    const groups = new Map<HTMLOptGroupElement, boolean>();
    for (const option of Array.from(select.options)) {
      const offered = option.value === "" || allowed.has(option.dataset.tool ?? "");
      option.hidden = !offered;
      option.disabled = !offered;
      const group = option.parentElement as HTMLOptGroupElement | null;
      if (group?.tagName === "OPTGROUP") groups.set(group, (groups.get(group) ?? true) && !offered);
    }
    for (const [group, empty] of groups) group.hidden = empty;
    if (select.selectedOptions[0]?.disabled) select.value = "";
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
  if (name === "model.implement") syncSidePickers(document, form);
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

/** The compact picker's own box, kept saying what the line is ON (the pair shown on
 *  narrow screens). The two selects inside it are the
 *  truth; this is the text over them, and a pick that left it stale
 *  would have the reader looking at "sonnet" over a Codex model until
 *  the next redraw.
 *
 *  Two spans, mirroring the server's own two candidate strings:
 *  `.aimodelshort` the bare model name, unless another
 *  CONFIGURED entry shares it — the same rule the server's
 *  `compactModelLabel()` applies — and `.aimodelfull` always tool-
 *  prefixed, the same rule as `compactModelLabelFull()`
 *  (`render/pages/specs-list/model-resolve.ts`). The two run in separate
 *  bundles with no shared module, so both must be kept applying the same
 *  rule by hand. Every configured model is an `<option data-tool>` in
 *  this select whatever tool is offered right now — `offerOnly()` only
 *  hides one, never removes it — so counting them here reads the same
 *  set the server's own array does, just off the DOM instead of
 *  `opts.modelChoices`.
 *
 *  The AI's word comes off the option the server wrote it on
 *  (`data-short`) — which word stands for which tool is a fact about
 *  the page — and the model is the select's own value. */
export function refreshAiModelBox(container: Element): void {
  const shortEl = container.querySelector(".aimodelshort");
  const fullEl = container.querySelector(".aimodelfull");
  const model = container.querySelector(MODEL_SELECTS) as HTMLSelectElement | null;
  if (!shortEl || !fullEl || !model) return;
  const ai = container.querySelector("select[data-ai]") as HTMLSelectElement | null;
  const short =
    ai?.selectedOptions[0]?.dataset.short ?? model.selectedOptions[0]?.dataset.tool ?? "";
  const collides =
    Array.from(model.querySelectorAll("option[data-tool]"))
      .filter((o) => (o as HTMLOptionElement).value === model.value).length > 1;
  const shortText = collides && short ? `${short} · ${model.value}` : model.value;
  const fullText = `${short} · ${model.value}`;
  shortEl.textContent = shortText;
  fullEl.textContent = fullText;
  const box = container.querySelector(".aimodelnow");
  box?.setAttribute("title", fullText);
}
