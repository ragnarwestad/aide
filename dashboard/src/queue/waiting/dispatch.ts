import type { WaitingEntry, WaitingQueue } from "./index.ts";
export interface RootAdmission {
  tryRun<T>(root: string, fn: () => Promise<T>): Promise<T> | undefined;
  onRelease(fn: () => void): () => void;
}
interface Intent {
  entry: WaitingEntry; roots: RootAdmission; root: string;
  start: () => Promise<unknown>; resolve: (value: any) => void; reject: (error: unknown) => void;
  cancelled: () => boolean;
}
export class WaitingDispatch {
  private intents = new Map<string, Intent>();
  private draining = false;
  constructor(private readonly queue: WaitingQueue) { queue.listeners.add(() => this.drain()); }
  run<T>(entry: WaitingEntry, roots: RootAdmission, root: string, start: () => Promise<T>, cancelled = () => false): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const off = roots.onRelease(() => this.drain());
      this.intents.set(entry.id, { entry, roots, root, start, cancelled,
        resolve: value => { off(); resolve(value); }, reject: error => { off(); reject(error); } });
      this.queue.pending.set(entry.id, entry);
      this.drain();
    });
  }
  drain(): void {
    if (this.draining) return;
    this.draining = true;
    try {
      const entries = this.queue.snapshot().entries;
      for (const entry of entries) {
        const intent = this.intents.get(entry.id);
        if (!intent) continue;
        if (intent.cancelled()) { this.remove(entry.id); intent.reject(new Error("Pending work was cancelled")); continue; }
        if (this.queue.paused || !this.queue.canAdmit(intent.entry)) continue;
        const work = intent.roots.tryRun(intent.root, () => {
          if (entry.id.startsWith("merge:") && entry.jobId) this.queue.admitted.add(entry.jobId);
          return intent.start();
        });
        if (!work) continue;
        this.remove(entry.id);
        work.then(intent.resolve, intent.reject);
      }
    } finally { this.draining = false; }
  }
  private remove(id: string): void { this.intents.delete(id); this.queue.removePending(id); }
}
const dispatchers = new WeakMap<WaitingQueue, WaitingDispatch>();
export function dispatchFor(queue: WaitingQueue): WaitingDispatch {
  let dispatcher = dispatchers.get(queue);
  if (!dispatcher) { dispatcher = new WaitingDispatch(queue); dispatchers.set(queue, dispatcher); }
  return dispatcher;
}
