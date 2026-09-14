// The jobs a pressed Deploy is waiting for before it restarts the
// service — process-lifetime state read by `pageShell()` directly, on
// `board-info.ts`'s precedent, rather than threaded through its call
// sites. `setPendingRestart` (serve/state.ts) is the one writer.

let jobs: string[] = [];

export function setPendingRestartNotice(waiting: string[]): void {
  jobs = [...waiting];
}

export function getPendingRestartNotice(): string[] {
  return jobs;
}
