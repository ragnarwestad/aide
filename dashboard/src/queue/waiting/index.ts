import { legalMove } from "./movement.ts";
import { loadOrder, writeOrder } from "./order.ts";
import type { Credential, Owner, WaitingEntry, WaitingOptions, WaitingSnapshot } from "./types.ts";
export type { Credential, Owner, WaitingEntry, WaitingSnapshot } from "./types.ts";

const TTL = 30_000;
export class WaitingQueue {
  private order: string[];
  private revision: number;
  get established(): boolean { return this.order.length > 0; }
  readonly reasons = new Map<string, string>();
  readonly admitted = new Set<string>();
  canAdmit(entry: WaitingEntry, entries = this.snapshot().entries): boolean {
    return this.options.admit?.(entry, entries, this.admitted) ?? true;
  }
  readonly pending = new Map<string, WaitingEntry>();
  private entries = new Map<string, WaitingEntry>();
  private lease?: { targetId: string; openingIds: string[]; request: string; token: string; expiresAt: number; issued: Map<string, string[]> };
  private readonly generation = crypto.randomUUID();
  private readonly now: () => number;
  private timer?: ReturnType<typeof setTimeout>;
  readonly listeners = new Set<() => void>();
  private last?: { token: string; generation: string; revision: number; action: string; ids: string; result: WaitingSnapshot };

  constructor(private readonly options: WaitingOptions) {
    const saved = loadOrder(options.path);
    this.order = saved.order;
    this.revision = saved.revision;
    this.now = options.now ?? Date.now;
  }
  private changed(): void {
    for (const listener of [this.options.changed, ...this.listeners]) {
      try { listener?.(); } catch (error) { console.error("queue: waiting notification failed", error); }
    }
  }
  private persist(order: string[], revision: number): void {
    if (this.options.persist) this.options.persist(order, revision);
    else if (this.options.path) writeOrder(this.options.path, order, revision);
  }
  reconcile(entries: WaitingEntry[]): void {
    entries = [...entries, ...this.pending.values()];
    this.entries = new Map(entries.map(e => [e.id, e]));
    // Merge segments retain their place between repository registrations.
    const retained = this.order.filter(id => this.entries.has(id) || (this.options.retainAbsent?.(id) ?? true));
    const additions = entries.filter(e => !retained.includes(e.id)).map(e => e.id);
    const next = [...retained, ...additions];
    if (next.length !== this.order.length || next.some((id, i) => id !== this.order[i])) {
      this.persist(next, this.revision);
      this.order = next;
    }
  }
  removePending(id: string): void { this.pending.delete(id); this.entries.delete(id); }
  private refresh(): void {
    this.reconcile(this.options.refresh?.() ?? [...this.entries.values()].filter(e => !this.pending.has(e.id)));
  }
  get paused(): boolean {
    if (this.lease && this.lease.expiresAt <= this.now()) this.release();
    return !!this.lease;
  }
  private release(): void {
    clearTimeout(this.timer);
    this.lease = undefined;
    this.changed();
  }
  private arm(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.paused; }, TTL + 1);
    this.timer.unref?.();
  }
  snapshot(): WaitingSnapshot {
    this.refresh();
    return { revision: this.revision, entries: this.order.flatMap(id => this.entries.has(id) ? [{ ...this.entries.get(id)!, reason: this.reasons.get(id) ?? this.entries.get(id)!.reason }] : []) };
  }
  private owned(owner: Credential): void {
    if (!this.paused || !this.lease || owner.generation !== this.generation || owner.token !== this.lease.token) {
      throw new Error("Queue editing ownership was lost. Open the queue again.");
    }
    if (owner.revision !== this.revision) throw new Error("The saved queue order has changed. Open the queue again.");
  }
  private issued(): Owner {
    const snapshot = this.snapshot();
    const ids = snapshot.entries.map(e => e.id);
    this.lease!.issued.set(JSON.stringify(ids), ids);
    return { ...snapshot, targetId: this.lease!.targetId, openingIds: [...this.lease!.openingIds], token: this.lease!.token, generation: this.generation, expiresAt: this.lease!.expiresAt };
  }
  open(request: string, targetId: string): Owner {
    if (!request || request.length > 200) throw new Error("An opening request id is required");
    if (this.paused && this.lease!.request !== request) throw new Error("The queue is being edited in another tab. Try again when it closes.");
    const snapshot = this.snapshot();
    const target = snapshot.entries.find(entry => entry.id === targetId);
    if (!target || target.operation !== "deploy" || !target.jobId || target.id.startsWith("deploy:")) throw new Error("Only a waiting Deploy can be edited");
    if (this.lease && this.lease.targetId !== targetId) throw new Error("The editing target cannot change");
    if (!this.lease) {
      this.lease = { targetId, openingIds: snapshot.entries.map(entry => entry.id), request, token: crypto.randomUUID(), expiresAt: this.now() + TTL, issued: new Map() };
      this.arm();
    }
    try { return this.issued(); }
    catch (error) { this.release(); throw error; }
  }
  renew(owner: Credential): Owner {
    this.owned(owner);
    this.lease!.expiresAt = this.now() + TTL;
    this.arm();
    return this.issued();
  }
  read(owner: Credential): Owner { this.owned(owner); return this.issued(); }
  save(owner: Credential & { snapshotIds?: string[] }, ids: string[]): WaitingSnapshot {
    if (this.retried(owner, "save", JSON.stringify(ids))) return this.last!.result;
    this.owned(owner);
    this.refresh();
    const issued = owner.snapshotIds ?? [...this.lease!.issued.values()][0]!;
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string") || !Array.isArray(issued) ||
        !this.lease!.issued.has(JSON.stringify(issued)) || ids.length !== issued.length ||
        new Set(ids).size !== ids.length || ids.some(id => !issued.includes(id))) {
      throw new Error("Save must contain each entry from the issued snapshot exactly once");
    }
    if (!this.entries.has(this.lease!.targetId) || !legalMove(issued, ids, this.lease!.targetId, this.lease!.openingIds)) {
      throw new Error("Only the selected waiting Deploy may move ahead of its opening position");
    }
    const present = new Set(this.entries.keys());
    const visible = [...ids.filter(id => present.has(id)), ...this.order.filter(id => present.has(id) && !issued.includes(id))];
    const next = this.order.flatMap(id => !present.has(id) && this.options.retainAbsent?.(id) ? [id] : visible.length ? [visible.shift()!] : []);
    next.push(...visible);
    this.persist(next, this.revision + 1);
    this.order = next;
    this.revision++;
    const result = this.snapshot();
    this.last = { ...owner, action: "save", ids: JSON.stringify(ids), result };
    this.release();
    return result;
  }
  cancel(owner: Credential): WaitingSnapshot {
    if (this.retried(owner, "cancel", "")) return this.last!.result;
    this.owned(owner);
    const result = { revision: this.revision, entries: [...this.entries.values()] };
    this.last = { ...owner, action: "cancel", ids: "", result };
    this.release();
    return result;
  }
  private retried(owner: Credential, action: string, ids: string): boolean {
    return !this.lease && this.last?.token === owner.token && this.last.generation === owner.generation &&
      this.last.revision === owner.revision && this.last.action === action && this.last.ids === ids;
  }
}
