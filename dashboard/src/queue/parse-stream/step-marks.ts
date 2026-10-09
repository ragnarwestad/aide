// A step's Log read back as the steps it has marked: one entry per step,
// in the order each was first marked, in the state its last mark left it.
// What a Close or Reopen dialog lists while its job runs.
//
// The marks have three writers, all in one shape: `aide-run-spec`'s own
// parts in the run log (`--- Step Aide: preparing — started`), the
// skill's steps in the transcript (`--- Step 1 of 4: … — done`), and the
// landing's merge step in the run log, prefixed `error: ` when it stopped.
import { capitalizeFirst } from "../../format/error-sentence.ts";
import type { LogPart } from "./step-log.ts";

/** A marked step's state: started is running, done and skipped are done,
 *  stopped is failed. */
export type MarkState = "running" | "done" | "failed";

export interface StepMark {
  /** The step's place, `stepKey()`: "Step 4 of 4", "Step Aide: preparing". */
  key: string;
  /** "Merge into main", its first letter capitalised. */
  title: string;
  state: MarkState;
  /** A stopped mark's reason, as the log wrote it. */
  why?: string;
}

/** A step's key, shared by a mark and the planned line it moves: the place
 *  the step has in its job, whatever words the model gives its title. Aide's
 *  two parts share the place "Aide", so their name stays in. */
export const stepKey = (place: string, title: string): string => (place === "Aide" ? `Step Aide: ${title}` : `Step ${place}`);

/** The ending is read loosely, as `STEP_MARK` reads it: `— done (nothing to
 *  keep)` is a done. The title is the shortest match, so a stopped merge's
 *  `— stopped: <why> — the close is not finished` ends it at the step. */
const MARK = /^--- Step (Aide|\d+ of \d+): (.+?) — (started|done|skipped|stopped)\b(?::\s*(.*))?/;

/** The run log's `HH:MM:SS +Ns ` stamp and a failure's `error: `. */
const PREFIX = /^(?:\d\d:\d\d:\d\d \+\d+s )?(?:error: )?/;

const STATE: Record<string, StepMark["state"]> = { started: "running", done: "done", skipped: "done", stopped: "failed" };

/** The four entities `esc()` writes, undone; `&amp;` last so it is not read twice. */
const unescape = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");

export function stepMarks(logs: LogPart[]): StepMark[] {
  const byKey = new Map<string, StepMark>();
  for (const line of logs.flatMap((part) => part.lines)) {
    const match = MARK.exec(unescape(line).replace(PREFIX, ""));
    if (!match) continue;
    const [, place, title, ending, why] = match as unknown as [string, string, string, string, string | undefined];
    const key = stepKey(place, title);
    // Steps run one at a time: a later step's mark means one still running
    // ended without saying so, and a spinner on it would be wrong.
    for (const other of byKey.values()) {
      if (other.key !== key && other.state === "running") other.state = "done";
    }
    const reason = ending === "stopped" ? why?.trim() : undefined;
    // A Map keeps a key where it was first set: the step keeps its place.
    byKey.set(key, { key, title: capitalizeFirst(title), state: STATE[ending]!, ...(reason ? { why: reason } : {}) });
  }
  return [...byKey.values()];
}
