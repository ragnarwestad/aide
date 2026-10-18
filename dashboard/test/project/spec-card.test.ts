// The rules for when a spec's Depends on and its four settings can be
// changed, as `cardStep` states them: which field is locked and why, what
// each shows, whether Save and Cancel show, and what Cancel puts back.

import { describe, expect, test } from "bun:test";
import {
  cardStep,
  type CardFacts,
  type CardField,
  type CardState,
  type CardValues,
} from "../../src/project/spec-card.ts";

const SAVED: CardValues = {
  dependsOn: ["81-first-spec"],
  acceptanceRequired: true,
  aiFormulate: true,
  criteriaChecks: "off",
  chooseApproach: false,
};
const FIELDS: CardField[] = ["dependsOn", "acceptanceRequired", "aiFormulate", "criteriaChecks", "chooseApproach"];
const SETTINGS_ANALYZE_READS: CardField[] = ["acceptanceRequired", "criteriaChecks", "chooseApproach"];

const row = (jobInFlight = false, analyzeRun = false): CardFacts => ({ place: "running-row", jobInFlight, analyzeRun });
const open = (facts: CardFacts, saved: CardValues = SAVED) => cardStep(undefined, { type: "opened", facts, saved });

/** The changes a reader makes by hand: the card as shown, with these fields moved. */
const shownWith = (state: CardState, changes: Partial<CardValues>): CardValues => ({
  ...cardStep(state, { type: "refused" }).view.shown,
  ...changes,
});
const change = (state: CardState, changes: Partial<CardValues>) =>
  cardStep(state, { type: "changed", shown: shownWith(state, changes) });

describe("the card on the Running row", () => {
  test("one answer names every lock, what each field shows, Save and Cancel, and what Cancel puts back (AC-1)", () => {
    const { view } = open(row());
    expect(view.locks).toEqual({
      dependsOn: null,
      acceptanceRequired: null,
      aiFormulate: "create-used",
      criteriaChecks: null,
      chooseApproach: null,
    });
    expect(view.shown).toEqual(SAVED);
    expect(view.saveCancel).toBe(true);
    expect(view.cancelOffered).toBe(false);
    expect(view.restore).toEqual(SAVED);
  });

  test("a queued, running or landing job locks Depends on and the three settings, and Save and Cancel do not show (AC-2)", () => {
    const { view } = open(row(true));
    for (const field of ["dependsOn", ...SETTINGS_ANALYZE_READS] as CardField[]) expect(view.locks[field]).toBe("job-in-flight");
    expect(view.locks.aiFormulate).toBe("create-used");
    expect(view.saveCancel).toBe(false);
  });

  test("a job in flight wins over analyze having run (AC-2)", () => {
    const { view } = open(row(true, true));
    for (const field of SETTINGS_ANALYZE_READS) expect(view.locks[field]).toBe("job-in-flight");
    expect(view.saveCancel).toBe(false);
  });

  test("with no job in flight, Depends on is open and Save and Cancel show (AC-2)", () => {
    const { view } = open(row(false, true));
    expect(view.locks.dependsOn).toBeNull();
    expect(view.saveCancel).toBe(true);
  });

  test("once analyze has run, the three settings are locked and Depends on stays open (AC-3)", () => {
    const { view } = open(row(false, true));
    for (const field of SETTINGS_ANALYZE_READS) expect(view.locks[field]).toBe("analyze-run");
    expect(view.locks.dependsOn).toBeNull();
    expect(view.saveCancel).toBe(true);
  });

  test("before analyze has run, the three settings are open (AC-3)", () => {
    const { view } = open(row());
    for (const field of SETTINGS_ANALYZE_READS) expect(view.locks[field]).toBeNull();
  });

  test("AI formulation is locked by create whatever the facts say (AC-4)", () => {
    for (const jobInFlight of [false, true]) {
      for (const analyzeRun of [false, true]) expect(open(row(jobInFlight, analyzeRun)).view.locks.aiFormulate).toBe("create-used");
    }
  });
});

describe("the card on New spec", () => {
  test("every field is open and Save and Cancel do not show (AC-1)", () => {
    const { view } = open({ place: "new-spec", jobInFlight: false, analyzeRun: false });
    for (const field of FIELDS) expect(view.locks[field]).toBeNull();
    expect(view.saveCancel).toBe(false);
  });

  test("AI formulation can be chosen (AC-4)", () => {
    expect(open({ place: "new-spec", jobInFlight: false, analyzeRun: false }).view.locks.aiFormulate).toBeNull();
  });
});

describe("what a change does to the card", () => {
  test("a change shows and offers Cancel, and Cancel puts back what was saved (AC-1)", () => {
    const changed = change(open(row()).state, { dependsOn: [], criteriaChecks: "stop" });
    expect(changed.view.shown.dependsOn).toEqual([]);
    expect(changed.view.shown.criteriaChecks).toBe("stop");
    expect(changed.view.cancelOffered).toBe(true);
    expect(changed.view.restore).toEqual(SAVED);
  });

  test("a change back to the saved value is no change, in any order of the dependencies", () => {
    const start = cardStep(undefined, { type: "opened", facts: row(), saved: { ...SAVED, dependsOn: ["a", "b"] } });
    const there = change(start.state, { dependsOn: ["b"] });
    expect(there.view.cancelOffered).toBe(true);
    const back = change(there.state, { dependsOn: ["b", "a"] });
    expect(back.view.cancelOffered).toBe(false);
  });

  test("saved leaves nothing to cancel and Cancel would put back the values just saved (AC-1)", () => {
    const changed = change(open(row()).state, { dependsOn: [], chooseApproach: true });
    const after = cardStep(changed.state, { type: "saved" });
    expect(after.view.cancelOffered).toBe(false);
    expect(after.view.restore.dependsOn).toEqual([]);
    expect(after.view.restore.chooseApproach).toBe(true);
    expect(after.view.shown).toEqual(after.view.restore);
  });

  test("refused keeps the change and Cancel offered (AC-1)", () => {
    const changed = change(open(row()).state, { chooseApproach: true });
    const after = cardStep(changed.state, { type: "refused" });
    expect(after.view.shown.chooseApproach).toBe(true);
    expect(after.view.cancelOffered).toBe(true);
    expect(after.view.restore).toEqual(SAVED);
  });

  test("Cancel puts back Depends on and every open setting, and offers nothing more to cancel (AC-5)", () => {
    const changed = change(open(row()).state, {
      dependsOn: [],
      acceptanceRequired: false,
      criteriaChecks: "warn",
      chooseApproach: true,
    });
    expect(changed.view.cancelOffered).toBe(true);
    const after = cardStep(changed.state, { type: "undone" });
    expect(after.view.shown).toEqual(SAVED);
    expect(after.view.cancelOffered).toBe(false);
  });

  test("a redraw with the same facts keeps a change not yet saved (AC-5)", () => {
    const changed = change(open(row()).state, { dependsOn: [] });
    const redrawn = cardStep(changed.state, { type: "opened", facts: row(), saved: SAVED });
    expect(redrawn.view.shown.dependsOn).toEqual([]);
    expect(redrawn.view.cancelOffered).toBe(true);
  });

  test("a locked field takes no change", () => {
    const state = open(row(false, true)).state;
    const after = change(state, { aiFormulate: false, chooseApproach: true });
    expect(after.view.shown.aiFormulate).toBe(true);
    expect(after.view.shown.chooseApproach).toBe(false);
    expect(after.view.cancelOffered).toBe(false);
  });
});

describe("when a job starts and ends under a card with unsaved changes", () => {
  const unsaved = () => change(open(row()).state, { dependsOn: [], criteriaChecks: "stop" }).state;

  test("the card locks, shows what was saved and offers no Save or Cancel (AC-6)", () => {
    const { view } = cardStep(unsaved(), { type: "job-started", facts: row(true), saved: SAVED });
    for (const field of ["dependsOn", ...SETTINGS_ANALYZE_READS] as CardField[]) expect(view.locks[field]).toBe("job-in-flight");
    expect(view.shown).toEqual(SAVED);
    expect(view.saveCancel).toBe(false);
    expect(view.cancelOffered).toBe(false);
  });

  test("a job starting is in flight whatever the facts of the event say (AC-6)", () => {
    const { view } = cardStep(unsaved(), { type: "job-started", facts: row(false), saved: SAVED });
    expect(view.saveCancel).toBe(false);
  });

  test("when the job ends with analyze not run, both changes show again and Cancel is offered (AC-6)", () => {
    const started = cardStep(unsaved(), { type: "job-started", facts: row(true), saved: SAVED });
    const { view } = cardStep(started.state, { type: "job-ended", facts: row(false), saved: SAVED });
    expect(view.shown.dependsOn).toEqual([]);
    expect(view.shown.criteriaChecks).toBe("stop");
    expect(view.saveCancel).toBe(true);
    expect(view.cancelOffered).toBe(true);
  });

  test("when the job ends with analyze run, the Depends on change shows again and the setting shows what was saved (AC-6)", () => {
    const started = cardStep(unsaved(), { type: "job-started", facts: row(true), saved: SAVED });
    const { view } = cardStep(started.state, { type: "job-ended", facts: row(false, true), saved: SAVED });
    expect(view.shown.dependsOn).toEqual([]);
    expect(view.shown.criteriaChecks).toBe("off");
    expect(view.cancelOffered).toBe(true);
  });

  test("a change the job's own save has since made is no longer a change (AC-6)", () => {
    const started = cardStep(unsaved(), { type: "job-started", facts: row(true), saved: SAVED });
    const both = { ...SAVED, dependsOn: [], criteriaChecks: "stop" as const };
    expect(cardStep(started.state, { type: "job-ended", facts: row(false), saved: both }).view.cancelOffered).toBe(false);
    const one = { ...SAVED, criteriaChecks: "stop" as const };
    const { view } = cardStep(started.state, { type: "job-ended", facts: row(false), saved: one });
    expect(view.shown.criteriaChecks).toBe("stop");
    expect(view.shown.dependsOn).toEqual([]);
    expect(view.cancelOffered).toBe(true);
  });
});
