// A step's Log read back as the steps it has marked: one entry per step,
// in the order each was first marked, in the state its last mark left it.
// What a Close's or Reopen's line on the Running page lists while its job runs.
//
// The marks have three writers, all in one shape: `aide-run-spec`'s own
// parts in the run log (`--- Step Aide: preparing — started`), the
// skill's steps in the transcript (`--- Step 1 of 4: … — done`, which the
// Log shows with the time `aide-run-spec` recorded for it), and the
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
  /** Seconds into the run the step started and ended, off the run log's
   *  `+Ns` stamp: Aide's own steps have them, and so do the model's in a run
   *  whose runner recorded its marks. A run from before has none for the model's. */
  startedSec?: number;
  endedSec?: number;
  /** The tokens the stream reported while the step ran (`stepTokens`). Only a
   *  step with a recorded time has them: a run from before shows none. */
  tokens?: number;
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
const PREFIX = /^(?:\d\d:\d\d:\d\d \+(\d+)s )?(?:error: )?/;

const STATE: Record<string, StepMark["state"]> = { started: "running", done: "done", skipped: "done", stopped: "failed" };

/** The four entities `esc()` writes, undone; `&amp;` last so it is not read twice. */
const unescape = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");

export function stepMarks(logs: LogPart[], tokens?: Map<string, number>): StepMark[] {
  const byKey = new Map<string, StepMark>();
  for (const line of logs.flatMap((part) => part.lines)) {
    const bare = unescape(line);
    const stamp = PREFIX.exec(bare)?.[1];
    const at = stamp === undefined ? undefined : Number(stamp);
    const match = MARK.exec(bare.replace(PREFIX, ""));
    if (!match) continue;
    const [, place, title, ending, why] = match as unknown as [string, string, string, string, string | undefined];
    const key = stepKey(place, title);
    // Steps run one at a time: a later step's mark means one still running
    // ended without saying so, and a spinner on it would be wrong.
    for (const other of byKey.values()) {
      if (other.key !== key && other.state === "running") {
        other.state = "done";
        if (at !== undefined && other.startedSec !== undefined && at >= other.startedSec) other.endedSec = at;
      }
    }
    const reason = ending === "stopped" ? why?.trim() : undefined;
    const startedSec = ending === "started" ? at : byKey.get(key)?.startedSec;
    // An end stamped before the start (a mark read out of order) is no duration, not a negative one.
    const endedSec = ending === "started" || (at !== undefined && startedSec !== undefined && at < startedSec) ? undefined : at;
    // A Map keeps a key where it was first set: the step keeps its place.
    byKey.set(key, {
      key,
      title: capitalizeFirst(title),
      state: STATE[ending]!,
      ...(reason ? { why: reason } : {}),
      ...(startedSec !== undefined ? { startedSec } : {}),
      ...(endedSec !== undefined && startedSec !== undefined ? { endedSec } : {}),
      ...(startedSec !== undefined && tokens?.has(key) ? { tokens: tokens.get(key)! } : {}),
    });
  }
  return [...byKey.values()];
}

/** The step a line marks and whether the mark ends it, or undefined for any other line. */
export function markOf(line: string): { key: string; ends: boolean } | undefined {
  const match = MARK.exec(unescape(line).replace(PREFIX, ""));
  return match ? { key: stepKey(match[1]!, match[2]!), ends: match[3] !== "started" } : undefined;
}

/** A step's Log cut at its marks: each marked step's own part of it, by the
 *  key `stepMarks` gives it. A step holds what came from its first mark until
 *  it ended; what came between one step's end and the next step's first mark,
 *  or before any mark, belongs to that next step, and what came after the
 *  last step ended, to that last step. A subagent's work stays whole. */
export function stepSlices(logs: LogPart[]): Map<string, LogPart[]> {
  const slices = new Map<string, LogPart[]>();
  let current: string | undefined;
  let last: string | undefined;
  let waiting: LogPart[] = [];
  const put = (part: LogPart): void => {
    if (current === undefined) waiting.push(part);
    else slices.get(current)!.push(part);
  };
  const enter = (key: string): void => {
    if (!slices.has(key)) slices.set(key, []);
    slices.get(key)!.push(...waiting);
    waiting = [];
    current = last = key;
  };
  for (const part of logs) {
    if (part.by === "subagent") {
      put(part);
      continue;
    }
    let lines: string[] = [];
    const flush = (): void => {
      if (lines.length) put({ by: part.by, lines });
      lines = [];
    };
    for (const line of part.lines) {
      const mark = markOf(line);
      if (mark && mark.key !== current) {
        flush();
        enter(mark.key);
      }
      lines.push(line);
      if (mark?.ends) {
        flush();
        current = undefined;
      }
    }
    flush();
  }
  if (waiting.length && last !== undefined) slices.get(last)!.push(...waiting);
  return slices;
}
