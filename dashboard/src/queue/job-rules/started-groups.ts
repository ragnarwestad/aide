/** Every process group a step of a project has started in this server,
 *  until a check finds it gone. A job carries its `pgid` only while its
 *  step runs — the step's end clears it, a cancel included — so a wait
 *  that must know a cancelled step's process has exited reads it here.
 *  The caller passes only real process ids. */
const started = new Map<string, Set<number>>();

export function noteStartedGroup(project: string, pgid: number): void {
  let groups = started.get(project);
  if (!groups) started.set(project, (groups = new Set()));
  groups.add(pgid);
}

/** The project's groups `alive` still finds; the ones it does not are
 *  forgotten, so an exited group's id is never read again later. */
export function liveStartedGroups(project: string, alive: (pgid: number) => boolean): number[] {
  const groups = started.get(project);
  if (!groups) return [];
  for (const pgid of groups) if (!alive(pgid)) groups.delete(pgid);
  return [...groups];
}

/** For tests: nothing started. */
export function clearStartedGroups(): void {
  started.clear();
}
