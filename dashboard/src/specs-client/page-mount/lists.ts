// The listeners on the lists' own containers, which sit in `<main>`: a page
// drawn in place brings new ones, so they are bound with the rest of the page
// (`mountPage`).

import { applyAiPick, refreshAiModelBox } from "../ai-sync.ts";
import { onApproachCancel, pickApproach } from "../approach-choice";
import { onDependsOnCancel, pickSetting } from "../depends-on";
import { submitAction, submitTestServerStop } from "../forms.ts";
import { navigate } from "../navigation.ts";
import { postPendingModel } from "../pending-model.ts";
import { relabelRunButton } from "../row-swap.ts";
import { checkboxKey, chosen, chosenSteps, selectKey } from "../state.ts";
import { postTailModel, postTailStep } from "../tail-actions.ts";

// Delegated from the container, because the controls are replaced along
// with the rows on every redraw — a listener on the links themselves
// would last until the next one. A page drawn in place brings a new
// container, and `bindLists` binds that one too.
function onRowsClick(event: MouseEvent): void {
  navigate(event);
  onApproachCancel(event);
  onDependsOnCancel(event);
}
// And the row's selects and boxes, for the same reason: the rows are
// replaced wholesale on every redraw, so a listener bound to a control
// itself would last until the next one.
const onRowsChange = ((event: Event) => {
  const target = event.target as Element | null;
  // The compact picker's box says what the line is on, and every branch
  // below can change that. Queued rather than called here: `applyAiPick`
  // writes the model select AFTER this listener's own branch runs, so
  // reading the box's text now would be reading it one pick behind.
  const picker = target?.closest?.(".aimodel") as Element | null;
  if (picker) queueMicrotask(() => refreshAiModelBox(picker));
  // An approach picked under a row's waiting line, remembered for the
  // next redraw like a ticked box.
  const approach = target?.closest?.('input[name="approach"]') as HTMLInputElement | null;
  if (approach?.name === "approach") return pickApproach(approach);
  // A dependency ticked in a row's Depends on picker, remembered the same way,
  // and a setting changed under it.
  const dependency = target?.closest?.("form.dependsform input[name=dependsOn]") as HTMLInputElement | null;
  if (dependency?.name === "dependsOn") return pickSetting(dependency);
  const setting = target?.closest?.("form.dependsform input[type=checkbox][name], form.dependsform select[name]") as
    | HTMLInputElement
    | HTMLSelectElement
    | null;
  if (setting && ["acceptanceRequired", "chooseApproach", "criteriaChecks"].includes(setting.name)) return pickSetting(setting);
  // A tail box's tick is a press, not something to remember for the
  // next redraw: it goes to the server now, and what comes
  // back is what the row is drawn from. The promise is returned rather
  // than dropped — a listener's return value is nobody's to wait on,
  // and it is what lets the test wait for the request the tick makes.
  const tail = target?.closest?.("input[data-post-to]") as HTMLInputElement | null;
  if (tail) return postTailStep(tail);
  // A phase's AI picker fills that phase's model in and is done.
  // It is intercepted BEFORE the branch below, and not only for
  // tidiness: it has no `name`, so `selectKey` would file every AI
  // select on the row under the same key — the form id and an empty
  // string — and the last one touched would decide the lot. Nothing
  // about it is remembered for the next redraw either; `applyAiPick`
  // records what it wrote under the select it wrote it into, and the
  // picker itself is set back from that select on the way out.
  // The model select on a phase the running job has not
  // reached. Same reasoning as the box above — there is no Run button
  // on a busy row to submit it with — so the pick goes to the running
  // job's own route now. The AI select beside it is set from this one
  // first, so the line does not sit showing a tool the model it posted
  // does not belong to.
  const liveModel = target?.closest?.("select[data-post-to]") as HTMLSelectElement | null;
  if (liveModel) return postTailModel(liveModel, liveModel.value);
  const ai = target?.closest?.("select[data-ai]") as HTMLSelectElement | null;
  if (ai) return applyAiPick(ai);
  // Every other select on the rows IS remembered: they are swapped
  // away by every redraw, and a model picked for the next run is a
  // promise the page has to keep.
  const select = target?.closest?.("select") as HTMLSelectElement | null;
  if (select) {
    chosen.set(selectKey(select), select.value);
    if (select.name?.startsWith("model.")) {
      // Recorded on the server the instant it is made, not
      // only in `chosen` — which is a fresh, empty map on every page
      // load and cannot survive leaving the page.
      void postPendingModel(select, select.name.slice("model.".length), select.value);
    }
  }
  // And the phase boxes, for the same reason and in a map of their own:
  // what is remembered about a box is whether it is ticked, which is
  // not a value a select can be restored from.
  // The acceptance criteria unfolded on a row are remembered
  // the same way: a `tick` box keyed by its own list's form, so an unsaved
  // tick outlives a redraw. Only a phase box has a Run button to relabel.
  // A criterion's boxes (`tick` and `unverified`; `failed`
  // on an archived spec) are one answer: checking one clears the others
  // beside it, and all are remembered as they now stand.
  const step = target?.closest?.(
    'input[name="steps"], input[name="tick"], input[name="unverified"], input[name="failed"]',
  ) as HTMLInputElement | null;
  if (step) {
    chosenSteps.set(checkboxKey(step), step.checked);
    if (step.name === "tick" || step.name === "unverified" || step.name === "failed") {
      for (const other of ["tick", "unverified", "failed"].filter((n) => n !== step.name)) {
        const sibling = step.closest?.("li")?.querySelector?.(`input[name="${other}"]`) as HTMLInputElement | null;
        if (!sibling || sibling === step) continue;
        if (step.checked) sibling.checked = false;
        chosenSteps.set(checkboxKey(sibling), sibling.checked);
      }
    }
    const rows = document.getElementById("jobrows");
    const formId = step.getAttribute("form");
    if (step.name === "steps" && rows && formId) relabelRunButton(rows, formId);
  }
}) as EventListener;

/** Binds the rows' and the Test servers list's containers, where the page has them. */
export function bindLists(doc: Document): void {
  const rows = doc.getElementById("jobrows");
  rows?.addEventListener("click", onRowsClick as EventListener);
  rows?.addEventListener("submit", submitAction as EventListener);
  rows?.addEventListener("change", onRowsChange);
  // The Test servers list's own Stop button.
  doc.getElementById("test-servers-rows")?.addEventListener("submit", submitTestServerStop as EventListener);
}
