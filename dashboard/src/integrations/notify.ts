// The notifier (spec 81, slice 81c): a job that stops at 02:00 — or
// fails there — must be visible in the morning without reading a log.
//
// The contract is claude-usage's, copied deliberately so ONE wrapper
// script can serve both dashboards: an argv array run with no shell,
// one line of JSON on stdin, spawn-and-forget, SIGTERM at 10 s and
// SIGKILL a second later, and absent entirely unless configured.
//
// Nothing here knows about Slack. The wrapper named in the config does,
// so the target can be swapped by editing one config line.

// `gate` was the fourth until spec 149: a job parked between two steps,
// waiting for a person to press Approve. There is no stop between steps
// any more, so nothing can announce one.
export type NotifyEventName = "finished" | "stopped" | "failed";

export interface NotifyEvent {
  event: NotifyEventName;
  project: string;
  spec: string;
  step?: string;
  jobId: string;
  reason?: string;
  costUsd: number;
  branchUrl?: string;
  at: string;
}

export interface NotifyChild {
  kill(signal: string): void;
  /** Resolves when the wrapper is done, so a well-behaved one is never
   *  signalled at all. */
  exited?: Promise<unknown>;
}

export type NotifySpawn = (argv: string[], line: string) => NotifyChild | null;

export interface NotifierOptions {
  /** The argv array. Absent or empty → the notifier is off. */
  command?: string[];
  spawn?: NotifySpawn;
  /** Injected in tests; setTimeout in production. */
  schedule?: (fn: () => void, ms: number) => unknown;
  termAfterMs?: number;
  killGraceMs?: number;
}

// The default spawn: no shell, the payload on stdin, output discarded.
// unref() so a wrapper can never hold the server open.
const defaultSpawn: NotifySpawn = (argv, line) => {
  const proc = Bun.spawn({
    cmd: argv,
    stdin: new TextEncoder().encode(line),
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.unref();
  return { kill: (signal) => proc.kill(signal as never), exited: proc.exited };
};

export class Notifier {
  private readonly command: string[];
  private readonly spawn: NotifySpawn;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly termAfterMs: number;
  private readonly killGraceMs: number;

  constructor(opts: NotifierOptions = {}) {
    this.command = opts.command ?? [];
    this.spawn = opts.spawn ?? defaultSpawn;
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.termAfterMs = opts.termAfterMs ?? 10_000;
    this.killGraceMs = opts.killGraceMs ?? 1_000;
  }

  get configured(): boolean {
    return this.command.length > 0;
  }

  /** Fire and forget. A broken notifier must never break a run: every
   *  failure here is swallowed on purpose. */
  notify(event: NotifyEvent): void {
    if (!this.configured) return;
    let child: NotifyChild | null = null;
    try {
      child = this.spawn(this.command, `${JSON.stringify(event)}\n`);
    } catch {
      return; // an unreachable wrapper is not the job's problem
    }
    if (!child) return;

    let done = false;
    child.exited?.then(
      () => (done = true),
      () => (done = true),
    );
    const signal = (sig: string) => {
      if (done) return;
      try {
        child!.kill(sig);
      } catch {
        // already gone
      }
    };
    this.schedule(() => signal("SIGTERM"), this.termAfterMs);
    this.schedule(() => signal("SIGKILL"), this.termAfterMs + this.killGraceMs);
  }
}
