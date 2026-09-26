// The jobs a pressed Deploy is waiting for before it restarts the
// service — process-lifetime state read by `pageShell()` directly, on
// `board-info.ts`'s precedent, rather than threaded through its call
// sites. `setPendingRestart` (serve/state.ts) is the one writer.

let jobs: string[] = [];
let startedAt: string | null = null;

/** `drawnBy` is when this process started: the page watches for another
 *  process to answer, which is the restart it is waiting for. */
export function setPendingRestartNotice(waiting: string[], drawnBy: string | null = null): void {
  jobs = [...waiting];
  startedAt = drawnBy;
}

export function getPendingRestartStartedAt(): string | null {
  return startedAt;
}

export function getPendingRestartNotice(): string[] {
  return jobs;
}
