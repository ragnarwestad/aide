// The spec list's browser code. TypeScript like the rest of the
// repo — `tsc --noEmit` covers it, and the server bundles it on the way
// out (`queueClientScript`, `serve/serve-helpers.ts`).
//
// One rule, applied twice: never reload the page under a control
// someone is half-way through setting. That is why the table refreshes
// itself in place, and why every button on it posts from here rather
// than letting the browser navigate. Create is the one deliberate
// exception, and it is not one of "the buttons on it": it is on a page
// of its own with nothing to keep (spec 121, see `submitCreate`).
//
// It used to have a second — answering the spec dropdown above the
// table, which had to update the step boxes, the "also touches" list
// and a summary line whenever the selection changed. Every spec has its
// own row-scoped control now, rendered by the server, so there is no
// selection left to react to and none of that code has a caller.
//
// This is the ENTRY POINT the bundler starts from (split queue-client.ts
// into a bundled folder): everything it USED to define inline now lives
// in src/queue-client/*.ts, themed by what it is rather than where it
// sits in one long file. What stays here is the wiring below — every
// top-level statement that binds a listener or runs once at load — kept
// in its ORIGINAL order, because several of these bindings depend on an
// earlier one having already run (`syncDependsOn()` before the New-spec
// form's own `change` listener is added, for instance).

import { applyAiPick, offerEachToItsTool, syncAiToModel } from "./queue-client/ai-sync.ts";
import {
  bindProposals,
  bindTypedConfirm,
  formNote,
  submitAction,
  submitCreate,
  submitDeploy,
  submitProjectChange,
  syncDependsOn,
} from "./queue-client/forms.ts";
import { formatElapsed } from "./queue-client/elapsed.ts";
import { connect, onVisibility } from "./queue-client/live.ts";
import { markGoing, navigate } from "./queue-client/navigation.ts";
import { postForm } from "./queue-client/press.ts";
import { relabelRunButton } from "./queue-client/row-swap.ts";
import { NEW_SPEC_FORM } from "./queue-client/state.ts";
import { postTailModel, postTailStep } from "./queue-client/tail-actions.ts";
import { checkboxKey, chosen, chosenSteps, selectKey } from "./queue-client/state.ts";

for (const el of document.querySelectorAll("form.addprojectform, form.removeform")) {
  const form = el as HTMLFormElement;
  bindTypedConfirm(form);
  bindProposals(form);
  form.addEventListener("submit", ((event: Event) => submitProjectChange(form, event)) as EventListener);
}

for (const el of document.querySelectorAll("form.deployform")) {
  const form = el as HTMLFormElement;
  form.addEventListener("submit", ((event: Event) => submitDeploy(form, event)) as EventListener);
}

const settingsCandidate = document.querySelector("form[data-settings-form]") as HTMLFormElement | null;
const settingsForm = settingsCandidate?.hasAttribute?.("data-settings-form") ? settingsCandidate : null;
settingsForm?.addEventListener("change", ((event: Event) => {
  const target = event.target as Element | null;
  const ai = target?.closest?.("select[data-ai]") as HTMLSelectElement | null;
  if (ai) return applyAiPick(ai);
  const model = target?.closest?.('select[name^="model."]') as HTMLSelectElement | null;
  if (model) syncAiToModel(model);
}) as EventListener);
settingsForm?.addEventListener("submit", (async (event: Event) => {
  if (event.defaultPrevented) return;
  event.preventDefault();
  await postForm(settingsForm, async () => formNote(settingsForm, "Defaults saved"), (why) => formNote(settingsForm, why));
}) as EventListener);

// Delegated from the container, because the controls are replaced along
// with the rows on every redraw — a listener on the links themselves
// would last until the next one.
document.getElementById("jobrows")?.addEventListener("click", navigate as EventListener);
// Spec 208: on the document, because the tab bar is not inside
// `#jobrows` and a tab is exactly the click 1-description.md measured.
document.addEventListener("click", markGoing as EventListener);
document.getElementById("jobrows")?.addEventListener("submit", submitAction as EventListener);
// And the row's selects and boxes, for the same reason: the rows are
// replaced wholesale on every redraw, so a listener bound to a control
// itself would last until the next one.
document.getElementById("jobrows")?.addEventListener("change", ((event: Event) => {
  const target = event.target as Element | null;
  // A tail box's tick is a press, not something to remember for the
  // next redraw (spec 160): it goes to the server now, and what comes
  // back is what the row is drawn from. The promise is returned rather
  // than dropped — a listener's return value is nobody's to wait on,
  // and it is what lets the test wait for the request the tick makes.
  const tail = target?.closest?.("input[data-post-to]") as HTMLInputElement | null;
  if (tail) return postTailStep(tail);
  // A phase's AI picker fills that phase's model in and is done (spec
  // 179). It is intercepted BEFORE the branch below, and not only for
  // tidiness: it has no `name`, so `selectKey` would file every AI
  // select on the row under the same key — the form id and an empty
  // string — and the last one touched would decide the lot. Nothing
  // about it is remembered for the next redraw either; `applyAiPick`
  // records what it wrote under the select it wrote it into, and the
  // picker itself is set back from that select on the way out.
  // Spec 225: the model select on a phase the running job has not
  // reached. Same reasoning as the box above — there is no Run button
  // on a busy row to submit it with — so the pick goes to the running
  // job's own route now. The AI select beside it is set from this one
  // first, so the line does not sit showing a tool the model it posted
  // does not belong to.
  const liveModel = target?.closest?.("select[data-post-to]") as HTMLSelectElement | null;
  if (liveModel) {
    syncAiToModel(liveModel);
    return postTailModel(liveModel, liveModel.value);
  }
  const ai = target?.closest?.("select[data-ai]") as HTMLSelectElement | null;
  if (ai) return applyAiPick(ai);
  // Every other select on the rows IS remembered: they are swapped
  // away by every redraw, and a model picked for the next run is a
  // promise the page has to keep.
  const select = target?.closest?.("select") as HTMLSelectElement | null;
  if (select) {
    chosen.set(selectKey(select), select.value);
    // A model moved by hand, without the picker beside it: the AI that
    // line shows has to follow it now, not at the next swap.
    if (select.name?.startsWith("model.")) syncAiToModel(select);
  }
  // And the phase boxes, for the same reason and in a map of their own:
  // what is remembered about a box is whether it is ticked, which is
  // not a value a select can be restored from (spec 141).
  const step = target?.closest?.('input[name="steps"]') as HTMLInputElement | null;
  if (step) {
    chosenSteps.set(checkboxKey(step), step.checked);
    const rows = document.getElementById("jobrows");
    const formId = step.getAttribute("form");
    if (rows && formId) relabelRunButton(rows, formId);
  }
}) as EventListener);
// The one listener that is NOT delegated: this form is the whole of its
// own page, with no swapped container to hang a delegated one off.
// The handler's promise is returned rather than dropped — a listener's
// return value is ignored by the DOM, and it is what lets the test wait
// for the request the press makes.
const newSpec = document.querySelector(NEW_SPEC_FORM) as HTMLFormElement | null;
newSpec?.addEventListener("submit", ((event: Event) => submitCreate(newSpec, event)) as EventListener);
// This page has no `#jobrows`, so the delegated model listener above
// cannot hear its AI and model controls.
newSpec?.addEventListener("change", ((event: Event) => {
  const target = event.target as Element | null;
  const ai = target?.closest?.("select[data-ai]") as HTMLSelectElement | null;
  if (ai) return applyAiPick(ai);
  const model = target?.closest?.('select[name^="model."]') as HTMLSelectElement | null;
  if (model) syncAiToModel(model);
}) as EventListener);
syncDependsOn();
newSpec?.querySelector("select[name=project]")?.addEventListener("change", syncDependsOn);

// The marks are looked up fresh on every tick rather than bound once,
// which is what lets it survive `swapRows()` replacing `#jobrows`
// underneath it with no rebinding at all. See `queue-client/elapsed.ts`
// for `formatElapsed` itself and the hand-pairing it carries.
setInterval(() => {
  // A stamp it cannot read is left exactly as the server drew it:
  // "NaN" in a cell is worse than a figure that stopped moving.
  for (const el of document.querySelectorAll("[data-elapsed]")) {
    const mark = el as HTMLElement;
    const since = Date.parse(mark.dataset.elapsed ?? "");
    if (Number.isNaN(since)) continue;
    mark.textContent = formatElapsed(Date.now() - since);
  }
}, 1000);

document.addEventListener("visibilitychange", onVisibility);
// The first paint: the server draws every model, and each select is
// narrowed to the tool its own value belongs to.
offerEachToItsTool(document);
// `?live=0` leaves the page as the server drew it, and nothing else
// about it changes. It stopped the five-second timer when there was
// one; it declines the live connection now, which is the same promise
// against a different mechanism — the browser's own tools cannot be
// used on a page that redraws under them.
connect();
