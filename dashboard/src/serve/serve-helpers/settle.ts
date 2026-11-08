// Both of a row's sources read again, now — for a test that has just
// written a spec's files and wants the page to agree with them.
//
// A row joins what git says about a spec with what the spec's own files
// claim, and the two are refreshed by different clocks: the git side by
// `refreshSpecCaches` on its own timer, the file side by a disk scan the
// specs-root watcher drops 300 ms after a change. A test that writes and
// asks immediately can land between the two and read one side stale.

import type { ServerState } from "../state.ts";

/** Waiting for `warming` is not decoration: `refreshSpecCaches` returns
 *  at once while a tick of its own is in flight, so calling it blind
 *  would settle nothing. Nothing awaits between the loop ending and the
 *  call, so no tick can start in between. */
export function makeSettle(state: ServerState, refreshSpecCaches: () => Promise<void>): () => Promise<void> {
  return async () => {
    while (state.warming) await new Promise((r) => setTimeout(r, 5));
    state.scan = null;
    await refreshSpecCaches();
  };
}
