// Whether a specs sweep has read every listed spec since the board started.
// Until then nothing says what a spec has done: its history is unread, and an
// unread history reads the same as one with no steps in it.

export interface FirstSweepMark {
  /** Whether the mark is set. */
  scanned: () => boolean;
  /** Sets the mark, once: runs what waited for it, then calls `onSet`. */
  mark: () => void;
  /** Runs `next` now when the mark is set, or else once it is. */
  whenScanned: (next: () => void) => void;
}

/** One board's mark, unset at every start. `onSet` tells open pages. */
export function firstSweepMark(onSet: () => void): FirstSweepMark {
  let scanned = false;
  let waiting: (() => void)[] = [];
  return {
    scanned: () => scanned,
    mark: () => {
      if (scanned) return;
      scanned = true;
      const run = waiting;
      waiting = [];
      for (const next of run) {
        try { next(); } catch (error) { console.error(`queue: work waiting for the first specs sweep failed — ${String(error)}`); }
      }
      onSet();
    },
    whenScanned: (next) => {
      if (scanned) next(); else waiting.push(next);
    },
  };
}
