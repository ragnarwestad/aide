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
export function bindWaitingEditor(): void {
  let opening = false;
  let active: { dialog: HTMLDialogElement; owner: Owner } | undefined;
  document.addEventListener("click", async event => {
    const badge = (event.target as Element)?.closest<HTMLElement>("[data-waiting-open]");
    if (!badge || opening || active) return;
    event.preventDefault();
    opening = true;
    let owner: (Owner & { html: string }) | undefined;
    try {
      owner = await post("open", { requestId: crypto.randomUUID() });
      const host = document.createElement("div");
      host.innerHTML = owner!.html;
      const dialog = host.firstElementChild as HTMLDialogElement;
      document.body.append(dialog);
      const state = { dialog, owner: owner! };
      active = state;
      mount(state, badge);
    } catch (error) {
      if (owner) void post("cancel", owner).catch(() => {});
      // A failed acquisition has no dialog; use the page's existing refusal surface.
      const { showRefusal } = await import("../tail-actions.ts");
      showRefusal(error instanceof Error ? error.message : String(error), undefined);
    } finally { opening = false; }
  });
  function mount(state: { dialog: HTMLDialogElement; owner: Owner }, badge: HTMLElement): void {
    const { dialog } = state;
    const form = dialog.querySelector<HTMLFormElement>("form[data-waiting-editor]")!;
    const box = dialog.querySelector<HTMLElement>("[data-waiting-queue]")!;
    const list = dialog.querySelector<HTMLOListElement>("[data-waiting-list]")!;
    const note = dialog.querySelector<HTMLElement>("[data-waiting-announcement]")!;
    const refused = dialog.querySelector<HTMLElement>(".refused")!;
    const save = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    let current = new Map<string, WaitingEntry>();
    let snapshotIds = state.owner.entries.map(entry => entry.id);
    let certain = true;
    let saving = false;
    let closed = false;
    const ids = () => [...list.querySelectorAll<HTMLElement>("[data-waiting-id]")].map(row => row.dataset.waitingId!);
    const numbered = () => {
      const rows = [...list.querySelectorAll<HTMLElement>("[data-waiting-id]")];
      const selected = document.activeElement?.closest<HTMLElement>("[data-waiting-id]");
      rows.forEach((row, index) => {
        row.querySelector<HTMLButtonElement>('[data-waiting-move="up"]')!.disabled = index === 0;
        row.querySelector<HTMLButtonElement>('[data-waiting-move="down"]')!.disabled = index === rows.length - 1;
      });
      if (selected && (document.activeElement as HTMLButtonElement)?.disabled) selected.focus();
      if (selected) note.textContent = `${rows.indexOf(selected) + 1}/${rows.length}`;
    };
    const render = (entries: WaitingEntry[]) => {
      current = new Map(entries.map(entry => [entry.id, entry]));
      for (const row of [...list.querySelectorAll<HTMLElement>("[data-waiting-id]")]) if (!current.has(row.dataset.waitingId!)) row.remove();
      for (const entry of entries) {
        let row = [...list.querySelectorAll<HTMLElement>("[data-waiting-id]")].find(row => row.dataset.waitingId === entry.id);
        if (!row) {
          row = document.createElement("li"); row.dataset.waitingId = entry.id; row.tabIndex = -1;
          const text = document.createElement("span"); text.dataset.waitingText = ""; row.append(text);
          row.append(dialog.querySelector<HTMLTemplateElement>("[data-waiting-controls]")!.content.cloneNode(true)); list.append(row);
        }
        row.querySelector<HTMLElement>("[data-waiting-text]")!.textContent = `${entry.project}: ${entry.label} · ${entry.operation}${entry.reason ? ` — ${entry.reason}` : ""}`;
      }
      if (!entries.length) note.textContent = box.dataset.empty!;
      numbered();
    };
    render(state.owner.entries);
    list.addEventListener("click", event => {
      const control = (event.target as Element).closest<HTMLElement>("[data-waiting-move]");
      const row = control?.closest<HTMLElement>("[data-waiting-id]");
      if (!row) return;
      if (control!.dataset.waitingMove === "up" && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
      else if (control!.dataset.waitingMove === "down" && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
      control!.focus(); numbered();
    });
    bindPointerMoves(list, numbered);
    const lost = (error: unknown) => { certain = false; save.disabled = true; refused.textContent = `${box.dataset.lost} ${error instanceof Error ? error.message : ""}`; };
    const refresh = async (action = "snapshot") => {
      if (closed || saving) return;
      try {
        const next: Owner = await post(action, state.owner);
        if (closed || saving) return;
        state.owner = next; snapshotIds = next.entries.map(entry => entry.id);
        render(next.entries); certain = true; save.disabled = false;
      } catch (error) { lost(error); }
    };
    const offline = () => lost(new Error());
    window.addEventListener("offline", offline);
    const timer = setInterval(() => { void refresh("renew"); }, 10_000);
    const live = setInterval(() => { if (navigator.onLine) void refresh(); }, 2_000);
    form.addEventListener("submit", async event => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!certain || saving) return;
      saving = true; save.disabled = true;
      try {
        await post("save", { ...state.owner, snapshotIds, ids: ids() });
        closed = true; dialog.close(); void swapRows();
      } catch (error) { refused.textContent = error instanceof Error ? error.message : String(error); if (/ownership|order has changed/.test(refused.textContent)) lost(error); save.disabled = !certain; }
      finally { saving = false; }
    });
    const release = () => {
      if (!closed) { closed = true; void post("cancel", state.owner, true).catch(() => {}); }
      clearInterval(timer); clearInterval(live);
      window.removeEventListener("offline", offline);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("popstate", leave);
      active = undefined; dialog.remove(); badge.isConnected && badge.focus();
    };
    const leave = () => { dialog.close(); release(); };
    window.addEventListener("pagehide", leave);
    window.addEventListener("popstate", leave);
    dialog.addEventListener("close", release, { once: true });
    showAsk(dialog);
    const selected = [...list.querySelectorAll<HTMLElement>("[data-waiting-id]")].find(row => row.dataset.waitingId === badge.dataset.waitingOpen);
    if (selected) { selected.focus(); selected.scrollIntoView({ block: "nearest" }); }
    else note.textContent = box.dataset.removed!;
  }
}
