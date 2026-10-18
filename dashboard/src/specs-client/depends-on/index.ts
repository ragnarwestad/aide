// The Depends on picker on a Running tab row (`render/pages/specs-list/depends-on/`),
// and the spec's settings under it. What the card may change and what Cancel
// puts back is `cardStep`'s (`project/spec-card.ts`); this file keeps one card
// state per form, feeds it the events the page produces, and writes what it
// shows back into the controls. A change outlives a live redraw of the rows,
// and a job starting locks the card without losing it.

import { cardStep, type CardEvent, type CardFacts, type CardState, type CardValues, type CardView } from "../../project/spec-card.ts";

/** One card per form id, kept across the redraws that replace the form. */
const cards = new Map<string, CardState>();

/** Forget every card: for the tests, which reuse form ids across cases. */
export function resetCards(): void {
  cards.clear();
}

// Selectors write the attribute value unquoted, which CSS allows for an
// identifier: quoted, the page script would carry the literal
// `name="dependsOn"`, and a page test looking for that field would find
// the script instead.
const boxesOf = (form: Element): HTMLInputElement[] =>
  Array.from(form.querySelectorAll("input[type=checkbox][name=dependsOn]")) as HTMLInputElement[];

/** A setting's box, by the attribute its chip carries: a locked one posts no name. */
const settingBox = (form: Element, attr: string): HTMLInputElement | null =>
  form.querySelector(`label[${attr}] input[type=checkbox]`);

const checksOf = (form: Element): HTMLSelectElement | null => form.querySelector("select");

const cancelOf = (form: Element): HTMLButtonElement | undefined =>
  (Array.from(form.querySelectorAll("button")) as HTMLButtonElement[]).find((b) => b.id === `${form.id}-cancel`);

/** A tick on a chip is the chip mover's cue (`ui/forms/depends-lift.ts`),
 *  which listens for `change`; a restore is silent, so the cue is sent. */
const announce = (box: HTMLInputElement): void => {
  box.dispatchEvent(new Event("change", { bubbles: true }));
};

/** The level the server drew: the option it marked `selected`. */
const drawnLevel = (select: HTMLSelectElement): string =>
  (Array.from(select.options).find((o) => o.hasAttribute("selected")) ?? select.options[0])?.value ?? "";

/** The facts the server drew the form with. */
const factsOf = (form: Element): CardFacts => ({
  place: "running-row",
  jobInFlight: form.hasAttribute("data-job-in-flight"),
  analyzeRun: form.hasAttribute("data-analyze-run"),
});

/** What the server drew: the boxes as marked checked and the level as marked selected. */
function savedOf(form: Element): CardValues {
  const select = checksOf(form);
  return {
    dependsOn: boxesOf(form).filter((b) => b.defaultChecked).map((b) => b.value),
    acceptanceRequired: settingBox(form, "data-acceptance")?.defaultChecked ?? false,
    aiFormulate: settingBox(form, "data-ai-formulate")?.defaultChecked ?? false,
    criteriaChecks: select ? drawnLevel(select) : "off",
    chooseApproach: settingBox(form, "data-choose-approach")?.defaultChecked ?? false,
  };
}

/** What the controls show now. */
function shownOf(form: Element): CardValues {
  const select = checksOf(form);
  return {
    dependsOn: boxesOf(form).filter((b) => b.checked).map((b) => b.value),
    acceptanceRequired: settingBox(form, "data-acceptance")?.checked ?? false,
    aiFormulate: settingBox(form, "data-ai-formulate")?.checked ?? false,
    criteriaChecks: select?.value ?? "off",
    chooseApproach: settingBox(form, "data-choose-approach")?.checked ?? false,
  };
}

/** True while the controls are being written, so the `change` events that
 *  tell the chip mover are not taken for a hand. */
let writing = false;

/** The card's view put into the controls: every box and the level set to what
 *  it shows, a moved chip announced, and Cancel offered or not. */
function show(form: Element, view: CardView): void {
  writing = true;
  try {
    const want = new Set(view.shown.dependsOn);
    for (const box of boxesOf(form)) {
      const on = want.has(box.value);
      if (box.checked === on) continue;
      box.checked = on;
      announce(box);
    }
    for (const [attr, on] of [
      ["data-acceptance", view.shown.acceptanceRequired],
      ["data-ai-formulate", view.shown.aiFormulate],
      ["data-choose-approach", view.shown.chooseApproach],
    ] as const) {
      const box = settingBox(form, attr);
      if (box) box.checked = on;
    }
    const select = checksOf(form);
    if (select && Array.from(select.options).some((o) => o.value === view.shown.criteriaChecks)) select.value = view.shown.criteriaChecks;
  } finally {
    writing = false;
  }
  const cancel = cancelOf(form);
  if (cancel) cancel.disabled = !view.cancelOffered;
}

function send(form: Element, event: CardEvent): void {
  const { state, view } = cardStep(cards.get(form.id), event);
  cards.set(form.id, state);
  show(form, view);
}

/** The card of a form drawn before the page script saw it: opened on what was
 *  drawn, and not written back, since the controls may already hold a hand. */
function ensureOpen(form: Element): void {
  if (cards.has(form.id)) return;
  cards.set(form.id, cardStep(undefined, { type: "opened", facts: factsOf(form), saved: savedOf(form) }).state);
}

/** A setting changed by hand: a box, or the checks level. */
export function pickSetting(control: HTMLInputElement | HTMLSelectElement): void {
  pickControl(control.closest("form.dependsform"));
}

/** A box ticked or cleared by hand. */
export function pickDependency(box: HTMLInputElement): void {
  pickControl(box.closest("form.dependsform"));
}

function pickControl(form: Element | null): void {
  if (!form || writing) return;
  ensureOpen(form);
  send(form, { type: "changed", shown: shownOf(form) });
}

/** Cancel: the form as it was last saved, the chips back in their blocks. */
export function cancelDependsOn(button: HTMLButtonElement): void {
  const form = button.closest("form.dependsform");
  if (!form) return;
  ensureOpen(form);
  send(form, { type: "undone" });
}

/** A press on a form went through (`saved`) or was refused (`refused`). Only a
 *  Depends on form has a card, so any other form is passed over. */
export function cardAnswered(form: Element, answer: "saved" | "refused"): void {
  if (cards.has(form.id)) send(form, { type: answer });
}

/** After a redraw, each fresh form is the server's answer again: the card is
 *  opened on it, or told that a job started or ended under it, and what it
 *  shows is written back — a change not yet saved comes back with its chip
 *  moved and Cancel offered. */
export function syncDependsOnForms(body: Element): void {
  for (const form of body.querySelectorAll("form.dependsform")) {
    const facts = factsOf(form);
    const was = cards.get(form.id)?.facts.jobInFlight;
    const type = was === undefined || was === facts.jobInFlight ? "opened" : facts.jobInFlight ? "job-started" : "job-ended";
    send(form, { type, facts, saved: savedOf(form) });
  }
}

/** The Cancel press, delegated from the rows' container. */
export function onDependsOnCancel(event: Event): void {
  const button = (event.target as Element | null)?.closest?.('form.dependsform button[type="button"]') as HTMLButtonElement | null;
  if (typeof button?.id === "string" && button.id.endsWith("-cancel")) cancelDependsOn(button);
}
