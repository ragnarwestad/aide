/** What of a project's work is still going, and a timed wait for it to
 *  end. Kept free of server imports: the liveness check of a process
 *  group is passed in, the way the runner takes `isAlive`. */

type WorkJob = { project: string; specFolder: string; state: string; landing?: boolean };

/** Each job of `project` that `busy` says is still going, by folder and
 *  activity (`81-queue-and-runner (landing)`), then each process group
 *  `alive` still finds (`process group 4242`). Empty when all has ended. */
export function unfinishedWork(
  jobs: readonly WorkJob[],
  project: string,
  groups: readonly number[],
  alive: (pgid: number) => boolean,
  busy: (job: { state: string; landing?: boolean }) => boolean,
): string[] {
  const left = jobs
    .filter((j) => j.project === project && busy(j))
    .map((j) => `${j.specFolder} (${j.landing ? "landing" : j.state})`);
  for (const pgid of groups) if (alive(pgid)) left.push(`process group ${pgid}`);
  return left;
}

/** A caller's own test seams for such a wait: the time limit, the poll,
 *  and the liveness check of a process group. */
export type WaitSeams = { limitMs?: number; pollMs?: number; alive?: (pgid: number) => boolean };

export interface WaitOptions {
  pollMs?: number;
  /** Run after each wait, before `still` is asked again. */
  between?: () => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Polls `still` until it is empty. When `limitMs` passes first, throws
 *  "<what> had not ended after <N> seconds: <what is still going>". */
export async function waitUntilEnded(
  still: () => string[],
  limitMs: number,
  what: string,
  opts: WaitOptions = {},
): Promise<void> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 250;
  const until = now() + limitMs;
  for (;;) {
    const left = still();
    if (left.length === 0) return;
    if (now() >= until) throw new Error(`${what} had not ended after ${limitMs / 1000} seconds: ${left.join(", ")}`);
    await sleep(pollMs);
    await opts.between?.();
  }
}
