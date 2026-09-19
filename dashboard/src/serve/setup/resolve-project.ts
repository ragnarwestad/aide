// The queue's own `ProjectResolver` (spec 193/198/406): which spec
// folders exist for a project, folded in with the two ways a resolved
// project can still be open past `targets()`'s own answer — an
// archived spec whose branch is still on origin (unlanded), and one
// that has been reopened or closed.

import type { ProjectResolver } from "../../queue/queue.ts";
import type { ServerState } from "../state.ts";
import type { SpecTarget } from "../../render";

export function createProjectResolver(
  state: ServerState,
  allowed: Set<string>,
  targets: () => SpecTarget[],
): ProjectResolver {
  return (project) => {
    if (!allowed.has(project)) return null;
    const folders = targets().filter((t) => t.project === project).map((t) => t.specFolder);
    // The way out (spec 193). An archived spec whose branch is still on
    // origin can have `archive` enqueued again — the runner hands that
    // step the open merge, the skill resolves it, and the landing that
    // follows merges cleanly.
    const prefix = `${project}/`;
    for (const key of state.unlanded) {
      if (key.startsWith(prefix)) folders.push(key.slice(prefix.length));
    }
    // The second way out (spec 198). An archived spec can be REOPENED,
    // in a list of its OWN, never appended to `specFolders` — widening
    // that list would take spec 193's guarantee with it.
    const archived: string[] = [];
    // The CLOSED subset of the same list (spec 406, REQ-7): read off
    // the scan's own `refs` rather than a second walk — `archived`,
    // above, is already the exact key set this filters, and `SpecRef`
    // already carries `closed` for every one of them.
    const closed: string[] = [];
    for (const key of state.scan?.archived ?? []) {
      if (!key.startsWith(prefix)) continue;
      archived.push(key.slice(prefix.length));
      if (state.scan?.refs.get(key)?.closed) closed.push(key.slice(prefix.length));
    }
    // An allowed project with no specs yet still resolves: a `schedule`
    // job needs no spec folder, and every other step is refused below
    // as an unknown folder, by name.
    return { specFolders: folders, archivedFolders: archived, closedFolders: closed };
  };
}
