import { legalMove } from "../../queue/waiting/movement.ts";
import { credentialOf } from "../../queue/waiting/credential.ts";
import type { Credential, Owner, WaitingEntry } from "../../queue/waiting";

/** What decides whether the draft may take a new order: whether the hold
 *  on the queue is still known to be ours, the entries the server last
 *  listed, and the order it issued with them. */
export interface DraftRules {
  certain: boolean;
  present: ReadonlySet<string> | ReadonlyMap<string, unknown>;
  snapshotIds: readonly string[];
  owner: Pick<Owner, "targetId" | "openingIds">;
}

/** The draft with `id` moved `offset` places, or none when that leaves the list. */
export function movedIds(ids: readonly string[], id: string, offset: number): string[] {
  const next = [...ids]; const from = next.indexOf(id);
  if (from + offset < 0 || from + offset >= next.length) return [];
  next.splice(from, 1); next.splice(from + offset, 0, id); return next;
}

/** Whether the draft may become `next`: only while the hold is ours and
 *  the selected job is still waiting, and only a move the server accepts. */
export function moveAllowed(rules: DraftRules, next: string[]): boolean {
  const { targetId, openingIds } = rules.owner;
  return rules.certain && rules.present.has(targetId) && legalMove(rules.snapshotIds, next, targetId, openingIds);
}

/** Which of a row's controls are disabled: only the selected job moves. */
export function rowControls(rules: DraftRules, ids: readonly string[], id: string): { up: boolean; down: boolean; drag: boolean } {
  const target = id === rules.owner.targetId;
  return {
    up: !target || !moveAllowed(rules, movedIds(ids, id, -1)),
    down: !target || !moveAllowed(rules, movedIds(ids, id, 1)),
    drag: !rules.certain || !target,
  };
}

/** A row's place in the list, as a screen reader hears it. */
export function positionText(ids: readonly string[], id: string): string {
  return `${ids.indexOf(id) + 1}/${ids.length}`;
}

/** A row's text: the entry's project, label and operation, and its reason when it has one. */
export function entryText(entry: WaitingEntry): string {
  return `${entry.project}: ${entry.label} · ${entry.operation}${entry.reason ? ` — ${entry.reason}` : ""}`;
}

/** How a fresh snapshot changes the draft's rows: rows whose entry is gone
 *  leave, entries the draft lacks join at the end in the server's order,
 *  and every row already there keeps the place the person gave it. */
export function reconcileRows(draftIds: readonly string[], entryIds: readonly string[]): { removed: string[]; added: string[] } {
  const listed = new Set(entryIds);
  const removed = draftIds.filter(id => !listed.has(id));
  const kept = new Set(draftIds.filter(id => listed.has(id)));
  return { removed, added: entryIds.filter(id => !kept.has(id)) };
}

/** Whether a fresh snapshot no longer lists the selected job. */
export function targetGone(owner: Pick<Owner, "entries" | "targetId">): boolean {
  return !owner.entries.some(entry => entry.id === owner.targetId);
}

/** Whether a refused save means the hold on the queue is gone. */
export function losesOwnership(message: string): boolean {
  return /ownership|order has changed/.test(message);
}

/** What a save sends: the hold's credential, the order it was issued, and the draft. */
export function saveBody(owner: Credential, snapshotIds: string[], ids: string[]): Credential & { snapshotIds: string[]; ids: string[] } {
  return { ...credentialOf(owner), snapshotIds, ids };
}

/** Whether a snapshot may be asked for, or its answer used: never once the
 *  editor has closed, nor while a save is on its way, whose answer would
 *  be overwritten by an older order. */
export function refreshAllowed(editor: { closed: boolean; saving: boolean }): boolean {
  return !editor.closed && !editor.saving;
}

/** Whether Save may send: only while the hold is known to be ours, and
 *  never a second time while the first is on its way. */
export function saveAllowed(editor: { certain: boolean; saving: boolean }): boolean {
  return editor.certain && !editor.saving;
}
