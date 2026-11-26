import { formDialog, btn, badge } from "../index.ts";
import { t, type Language } from "../../../../i18n";
import { esc } from "../../html.ts";

export function queueEditor(lang: Language): string {
  return formDialog(lang, { id: "waiting-editor", title: t(lang, "queue.title"), action: "/api/queue/waiting/save", hook: "actionform",
    data: { "waiting-editor": "" }, fields:
      `<div data-waiting-queue data-up="${esc(t(lang, "queue.up"))}" data-down="${esc(t(lang, "queue.down"))}" data-drag="${esc(t(lang, "queue.drag"))}" data-empty="${esc(t(lang, "queue.empty"))}" data-lost="${esc(t(lang, "queue.lost"))}" data-removed="${esc(t(lang, "queue.removed"))}">` +
      `<template data-waiting-controls><span class="factions">${btn({ type: "button", small: true, label: "↕", ariaLabel: t(lang, "queue.drag"), data: { "waiting-drag": "" } })}${btn({ type: "button", small: true, label: t(lang, "queue.up"), data: { "waiting-move": "up" } })}${btn({ type: "button", small: true, label: t(lang, "queue.down"), data: { "waiting-move": "down" } })}</span></template><p class="muted small">${esc(t(lang, "queue.help"))}</p><ol data-waiting-list></ol><p data-waiting-announcement role="status" aria-live="polite"></p><p data-waiting-position role="status" aria-live="polite"></p></div>` });
}
export function queueBadge(lang: Language, id: string, n: number, total: number, reason?: string, editable = false): string {
  if (!editable) return badge("waiting", t(lang, "list.stateQueuedPosition", { n, total }), reason);
  return btn({ type: "button", badge: "waiting", label: t(lang, "list.stateQueuedPosition", { n, total }), title: reason,
    data: { "waiting-open": id } });
}
