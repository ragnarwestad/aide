// Whether a spec's Depends on and its four settings can be changed — on the
// Running row's card and on New spec — as one small state machine. It imports
// nothing at run time: the page script bundles it, and the server runs it.

export type CardPlace = "running-row" | "new-spec";
export type CardField = "dependsOn" | "acceptanceRequired" | "aiFormulate" | "criteriaChecks" | "chooseApproach";
export type CardSetting = Exclude<CardField, "dependsOn">;
export type CardLock = "job-in-flight" | "analyze-run" | "create-used";

export interface CardFacts {
  place: CardPlace;
  /** A job of the spec is queued, running or landing. */
  jobInFlight: boolean;
  analyzeRun: boolean;
}

export interface CardValues {
  dependsOn: string[];
  acceptanceRequired: boolean;
  aiFormulate: boolean;
  criteriaChecks: string;
  chooseApproach: boolean;
}

export interface CardState {
  facts: CardFacts;
  /** What was last saved: what the server drew, or what a save just sent. */
  saved: CardValues;
  /** The fields the reader changed and has not saved, each with its value. */
  changes: Partial<CardValues>;
}

export type CardEvent =
  | { type: "opened"; facts: CardFacts; saved: CardValues }
  | { type: "changed"; shown: CardValues }
  | { type: "saved" }
  | { type: "refused" }
  | { type: "undone" }
  | { type: "job-started"; facts: CardFacts; saved: CardValues }
  | { type: "job-ended"; facts: CardFacts; saved: CardValues };

export interface CardView {
  /** Why each field cannot be changed, or null where it can. */
  locks: Record<CardField, CardLock | null>;
  /** What each field shows: what was saved, with each change on a field that is open. */
  shown: CardValues;
  /** Save and Cancel are drawn. */
  saveCancel: boolean;
  /** Cancel can be pressed: a field that is open shows something other than what was saved. */
  cancelOffered: boolean;
  /** What Cancel puts back: what was last saved. */
  restore: CardValues;
}

const FIELDS: readonly CardField[] = ["dependsOn", "acceptanceRequired", "aiFormulate", "criteriaChecks", "chooseApproach"];

/** The three settings analyze reads: open until it has run. */
const ANALYZE_READS: readonly CardField[] = ["acceptanceRequired", "criteriaChecks", "chooseApproach"];

function locksOf(facts: CardFacts): Record<CardField, CardLock | null> {
  const locks = Object.fromEntries(FIELDS.map((f) => [f, null])) as Record<CardField, CardLock | null>;
  if (facts.place === "new-spec") return locks;
  // Create has used the AI formulation; a job in flight does not change why it is locked.
  locks.aiFormulate = "create-used";
  const reason: CardLock | null = facts.jobInFlight ? "job-in-flight" : null;
  locks.dependsOn = reason;
  for (const f of ANALYZE_READS) locks[f] = reason ?? (facts.analyzeRun ? "analyze-run" : null);
  return locks;
}

const same = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b) ? [...a].sort().join("\n") === [...b].sort().join("\n") : a === b;

/** A change is kept while its field is open or locked only by a job in
 *  flight, and dropped once its field is locked for good or it equals what
 *  was saved. */
function kept(facts: CardFacts, saved: CardValues, changes: Partial<CardValues>): Partial<CardValues> {
  const locks = locksOf(facts);
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) {
    const change = (changes as Record<string, unknown>)[f];
    if (change === undefined) continue;
    if (locks[f] !== null && locks[f] !== "job-in-flight") continue;
    if (!same(change, saved[f])) out[f] = change;
  }
  return out as Partial<CardValues>;
}

function viewOf(state: CardState): CardView {
  const locks = locksOf(state.facts);
  const shown: Record<string, unknown> = { ...state.saved };
  let cancelOffered = false;
  for (const f of FIELDS) {
    const change = (state.changes as Record<string, unknown>)[f];
    if (locks[f] !== null || change === undefined) continue;
    shown[f] = change;
    cancelOffered = true;
  }
  const open = FIELDS.some((f) => locks[f] === null);
  return {
    locks,
    shown: shown as unknown as CardValues,
    saveCancel: state.facts.place === "running-row" && open,
    cancelOffered,
    restore: state.saved,
  };
}

/** The card after an event, and what it shows. An event other than
 *  `opened` needs the card to have been opened before. */
export function cardStep(state: CardState | undefined, event: CardEvent): { state: CardState; view: CardView } {
  const next = nextState(state, event);
  return { state: next, view: viewOf(next) };
}

function nextState(state: CardState | undefined, event: CardEvent): CardState {
  if (event.type === "opened") {
    return { facts: event.facts, saved: event.saved, changes: kept(event.facts, event.saved, state?.changes ?? {}) };
  }
  if (!state) throw new Error(`the card was not opened before "${event.type}"`);
  const { facts, saved } = state;
  switch (event.type) {
    case "changed": {
      const locks = locksOf(facts);
      const changes: Record<string, unknown> = { ...state.changes };
      for (const f of FIELDS) {
        if (locks[f] !== null) continue;
        const value = event.shown[f];
        if (same(value, saved[f])) delete changes[f];
        else changes[f] = value;
      }
      return { facts, saved, changes: kept(facts, saved, changes as Partial<CardValues>) };
    }
    case "saved":
      return { facts, saved: viewOf(state).shown, changes: {} };
    case "refused":
      return state;
    case "undone":
      return { facts, saved, changes: {} };
    case "job-started":
    case "job-ended": {
      const now = { ...event.facts, jobInFlight: event.type === "job-started" };
      return { facts: now, saved: event.saved, changes: kept(now, event.saved, state.changes) };
    }
  }
}
