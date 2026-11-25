import { legalMove } from "../../queue/waiting/movement.ts";
import { credentialOf } from "../../queue/waiting/credential.ts";
import { showAsk } from "../ask.ts";
import type { Owner, WaitingEntry } from "../../queue/waiting";
import { bindPointerMoves } from "./reorder.ts";
import { swapRows } from "../row-swap";

async function post(action: string, body: unknown, keepalive = false): Promise<any> {
  const response = await fetch(`/api/queue/waiting/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "The queue request failed");
  return result;
}

type EditorState = { dialog: HTMLDialogElement; owner: Owner };

/** The editor open on the page, and whether one is being opened. */
const editing: { opening: boolean; active: EditorState | undefined } = { opening: false, active: undefined };

/** A click on a waiting badge: the queue's order is taken for this page,
 *  and the editor opened on it. */
async function openWaitingEditor(event: MouseEvent): Promise<void> {
  const badge = (event.target as Element)?.closest<HTMLElement>("[data-waiting-open]");
  if (!badge || editing.opening || editing.active) return;
  event.preventDefault();
  editing.opening = true;
  let owner: (Owner & { html: string }) | undefined;
  try {
    owner = await post("open", { requestId: crypto.randomUUID(), entryId: badge.dataset.waitingOpen });
    const host = document.createElement("div");
    host.innerHTML = owner!.html;
    const dialog = host.firstElementChild as HTMLDialogElement;
    document.body.append(dialog);
    const state = { dialog, owner: owner! };
    editing.active = state;
    new WaitingEditor(state, badge).start();
  } catch (error) {
    if (owner) void post("cancel", credentialOf(owner)).catch(() => {});
    // A failed acquisition has no dialog; use the page's existing refusal surface.
    const { showRefusal } = await import("../tail-actions.ts");
    showRefusal(error instanceof Error ? error.message : String(error), undefined);
  } finally { editing.opening = false; }
}

/** The open editor: the list, the moves it allows, and the hold on the
 *  queue's order that it renews until it is saved or let go. */
class WaitingEditor {
  private readonly dialog: HTMLDialogElement;
  private readonly form: HTMLFormElement;
  private readonly box: HTMLElement;
  private readonly list: HTMLOListElement;
  private readonly note: HTMLElement;
  // A moved row's new place, for a screen reader only: the page already shows it.
  private readonly position: HTMLElement;
  private readonly refused: HTMLElement;
  private readonly save: HTMLButtonElement;
  private current = new Map<string, WaitingEntry>();
  private snapshotIds: string[];
  private certain = true;
  private saving = false;
  private closed = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private live: ReturnType<typeof setInterval> | undefined;
  private readonly offline = () => this.lost(new Error());
  private readonly leave = () => { this.dialog.close(); this.release(); };

  constructor(private readonly state: EditorState, private readonly badge: HTMLElement) {
    const { dialog } = state;
    this.dialog = dialog;
    this.form = dialog.querySelector<HTMLFormElement>("form[data-waiting-editor]")!;
    this.box = dialog.querySelector<HTMLElement>("[data-waiting-queue]")!;
    this.list = dialog.querySelector<HTMLOListElement>("[data-waiting-list]")!;
    this.note = dialog.querySelector<HTMLElement>("[data-waiting-announcement]")!;
    this.position = dialog.querySelector<HTMLElement>("[data-waiting-position]")!;
    this.refused = dialog.querySelector<HTMLElement>(".refused")!;
    this.save = this.form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    this.snapshotIds = state.owner.entries.map(entry => entry.id);
  }

  private rows(): HTMLElement[] {
    return [...this.list.querySelectorAll<HTMLElement>("[data-waiting-id]")];
  }

  private ids(): string[] {
    return this.rows().map(row => row.dataset.waitingId!);
  }

  private readonly allowed = (next: string[]): boolean =>
    this.certain && this.current.has(this.state.owner.targetId) && legalMove(this.snapshotIds, next, this.state.owner.targetId, this.state.owner.openingIds);

  private movedIds(row: HTMLElement, offset: number): string[] {
    const next = this.ids(); const from = next.indexOf(row.dataset.waitingId!);
    if (from + offset < 0 || from + offset >= next.length) return [];
    next.splice(from, 1); next.splice(from + offset, 0, row.dataset.waitingId!); return next;
  }

  /** Each row's move buttons and handle as the moves allow, and the selected row's place. */
  private readonly numbered = (): void => {
    const rows = this.rows();
    const targetId = this.state.owner.targetId;
    const selected = document.activeElement?.closest<HTMLElement>("[data-waiting-id]");
    rows.forEach(row => {
      row.querySelector<HTMLButtonElement>('[data-waiting-move="up"]')?.toggleAttribute("disabled", row.dataset.waitingId !== targetId || !this.allowed(this.movedIds(row, -1)));
      row.querySelector<HTMLButtonElement>('[data-waiting-move="down"]')?.toggleAttribute("disabled", row.dataset.waitingId !== targetId || !this.allowed(this.movedIds(row, 1)));
    });
    for (const row of rows) {
      const handle = row.querySelector<HTMLButtonElement>("[data-waiting-drag]");
      if (handle) handle.disabled = !this.certain || row.dataset.waitingId !== targetId;
    }
    if (selected && (document.activeElement as HTMLButtonElement)?.disabled) selected.focus();
    if (selected) this.position.textContent = `${rows.indexOf(selected) + 1}/${rows.length}`;
  };

  private render(entries: WaitingEntry[]): void {
    this.current = new Map(entries.map(entry => [entry.id, entry]));
    for (const row of this.rows()) if (!this.current.has(row.dataset.waitingId!)) row.remove();
    for (const entry of entries) {
      let row = this.rows().find(row => row.dataset.waitingId === entry.id);
      if (!row) {
        row = document.createElement("li"); row.dataset.waitingId = entry.id; row.tabIndex = -1;
        const text = document.createElement("span"); text.dataset.waitingText = ""; row.append(text);
        if (entry.id === this.state.owner.targetId) row.append(this.dialog.querySelector<HTMLTemplateElement>("[data-waiting-controls]")!.content.cloneNode(true)); this.list.append(row);
      }
      row.querySelector<HTMLElement>("[data-waiting-text]")!.textContent = `${entry.project}: ${entry.label} · ${entry.operation}${entry.reason ? ` — ${entry.reason}` : ""}`;
    }
    if (!entries.length) this.note.textContent = this.box.dataset.empty!;
    this.numbered();
  }

  private readonly onListClick = (event: Event): void => {
    const control = (event.target as Element).closest<HTMLElement>("[data-waiting-move]");
    const row = control?.closest<HTMLElement>("[data-waiting-id]");
    if (!row || row.dataset.waitingId !== this.state.owner.targetId || !this.allowed(this.movedIds(row, control!.dataset.waitingMove === "up" ? -1 : 1))) return;
    if (control!.dataset.waitingMove === "up" && row.previousElementSibling) this.list.insertBefore(row, row.previousElementSibling);
    else if (control!.dataset.waitingMove === "down" && row.nextElementSibling) this.list.insertBefore(row.nextElementSibling, row);
    control!.focus(); this.numbered();
  };

  private lost(error: unknown): void {
    this.certain = false; this.save.disabled = true; this.numbered();
    this.refused.textContent = `${this.box.dataset.lost} ${error instanceof Error ? error.message : ""}`;
  }

  private async refresh(action = "snapshot"): Promise<void> {
    if (this.closed || this.saving) return;
    try {
      const next: Owner = await post(action, credentialOf(this.state.owner));
      if (this.closed || this.saving) return;
      this.state.owner = next; this.snapshotIds = next.entries.map(entry => entry.id);
      this.certain = true; this.render(next.entries);
      if (!this.current.has(next.targetId)) { this.lost(new Error(this.box.dataset.removed)); return; }
      this.save.disabled = false;
    } catch (error) { this.lost(error); }
  }

  private readonly onSubmit = async (event: Event): Promise<void> => {
    event.preventDefault(); event.stopImmediatePropagation();
    if (!this.certain || this.saving) return;
    this.saving = true; this.save.disabled = true;
    try {
      await post("save", { ...credentialOf(this.state.owner), snapshotIds: this.snapshotIds, ids: this.ids() });
      this.closed = true; this.dialog.close(); void swapRows();
    } catch (error) {
      this.refused.textContent = error instanceof Error ? error.message : String(error);
      if (/ownership|order has changed/.test(this.refused.textContent)) this.lost(error);
      this.save.disabled = !this.certain;
    } finally { this.saving = false; }
  };

  private readonly release = (): void => {
    if (!this.closed) { this.closed = true; void post("cancel", credentialOf(this.state.owner), true).catch(() => {}); }
    clearInterval(this.timer); clearInterval(this.live);
    window.removeEventListener("offline", this.offline);
    window.removeEventListener("beforeunload", this.leave);
    window.removeEventListener("pagehide", this.leave);
    window.removeEventListener("popstate", this.leave);
    editing.active = undefined; this.dialog.remove(); this.badge.isConnected && this.badge.focus();
  };

  start(): void {
    this.render(this.state.owner.entries);
    this.list.addEventListener("click", this.onListClick);
    bindPointerMoves(this.list, this.numbered, this.allowed, () => this.state.owner.targetId);
    window.addEventListener("offline", this.offline);
    this.timer = setInterval(() => { void this.refresh("renew"); }, 10_000);
    this.live = setInterval(() => { if (navigator.onLine) void this.refresh(); }, 2_000);
    this.form.addEventListener("submit", this.onSubmit);
    window.addEventListener("beforeunload", this.leave);
    window.addEventListener("pagehide", this.leave);
    window.addEventListener("popstate", this.leave);
    this.dialog.addEventListener("close", this.release, { once: true });
    showAsk(this.dialog);
    const selected = this.rows().find(row => row.dataset.waitingId === this.badge.dataset.waitingOpen);
    if (selected) { selected.focus(); selected.scrollIntoView({ block: "nearest" }); }
    else this.note.textContent = this.box.dataset.removed!;
  }
}

export function bindWaitingEditor(): void {
  document.addEventListener("click", event => openWaitingEditor(event));
}
