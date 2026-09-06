// Telling every open tab that something moved — pulled out of
// `createServer`'s closure the same way the earlier clusters were
// (spec: split serve.ts, step 8). The state itself (`watchers`,
// `encoder`, `specWatchers`, `notifySoon`, and the boot-time loop that
// opens a `fs.watch` per allowed project) stays in `createServer`:
// only the four functions that act on it move here.

export interface SseWatchersContext {
  encoder: TextEncoder;
  watchers: Set<ReadableStreamDefaultController<Uint8Array>>;
  specWatchers: Map<string, { close: () => void }>;
  /** `notifySoon` is a `let` reassigned by both `scheduleNotify` (which
   *  debounces itself) and `closeSpecWatchers` (which cancels a pending
   *  one on shutdown) — a getter/setter pair, the same shape every
   *  mutable `let` in these extracted contexts gets. */
  readNotifySoon: () => ReturnType<typeof setTimeout> | null;
  writeNotifySoon: (v: ReturnType<typeof setTimeout> | null) => void;
  invalidateScan: () => void;
}

/** Write to one watcher, and forget it the moment it refuses. A tab
 *  that has gone away throws on enqueue, and a broadcast that let
 *  that through would stop at the first dead page and leave every
 *  live one unaware — the same fail-open the rest of this surface
 *  keeps (`branch-status`). */
export function writeTo(ctx: SseWatchersContext, c: ReadableStreamDefaultController<Uint8Array>, text: string): void {
  try {
    c.enqueue(ctx.encoder.encode(text));
  } catch {
    ctx.watchers.delete(c);
  }
}

/** Something a row is drawn from moved. Called from the queue's own
 *  write hook below and from `POST /api/aide-run` — the two sources a
 *  row reads, and the second is invisible to the first. A copy of the
 *  set is walked because `writeTo` removes from it. */
export function notifyQueueChanged(ctx: SseWatchersContext): void {
  for (const c of [...ctx.watchers]) writeTo(ctx, c, "event: changed\ndata: {}\n\n");
}

// --- spec 204: a spec is a folder, and a folder changes no job -----------
//
// The two callers above are both the queue's own: a job moving, and
// `POST /api/aide-run`. A spec created any other way — a `git pull`,
// a hand-run `/aide-create`, a headless run's commit landing — writes
// a directory and touches no job at all, so nothing was told and the
// page stayed as it was until somebody reloaded it. Four specs added
// on 2026-08-23 spent the day invisible that way.
//
// Each allowed project's specs root, and nothing wider: a recursive
// watch on the projects root would fire on every `.git` internal,
// `node_modules` entry and build artefact in every checked-out
// project — the ground moving under the reader constantly, which is
// the cost spec 189 already removed once.
//
// One echo comes with it, and is deliberately left alone: FSEvents
// hands a fresh recursive watcher the changes made in the
// milliseconds before it opened, so a server started right after
// something wrote in a specs root broadcasts once at start-up. A page
// open at that moment redraws once — which a reconnect already does —
// and a page opened afterwards never hears it.

/** A `git pull` writes a hundred files; the page needs telling once. */
export function scheduleNotify(ctx: SseWatchersContext): void {
  const pending = ctx.readNotifySoon();
  if (pending) clearTimeout(pending);
  ctx.writeNotifySoon(
    setTimeout(() => {
      ctx.writeNotifySoon(null);
      // Before the event, never after: the page answers by asking for
      // the rows, and those come off a scan cached for five seconds.
      // Told to redraw and handed the same list it already had, it
      // would sit there with nothing further coming.
      ctx.invalidateScan();
      notifyQueueChanged(ctx);
    }, 300),
  );
}

/** Every watcher opened above, closed. Called by `stop()`, which runs
 *  before a test removes the directories they point at. */
export function closeSpecWatchers(ctx: SseWatchersContext): void {
  const pending = ctx.readNotifySoon();
  if (pending) clearTimeout(pending);
  ctx.writeNotifySoon(null);
  for (const w of ctx.specWatchers.values()) {
    try {
      w.close();
    } catch {
      // already gone, which is the outcome either way
    }
  }
  ctx.specWatchers.clear();
}
