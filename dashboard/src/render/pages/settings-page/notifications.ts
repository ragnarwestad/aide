// The Notifications tab (spec 501): one control for the device the page
// is open on. Everything the script needs rides on the panel's own
// attributes — the server's public key to subscribe with and the
// language the device reads, which is stored with its subscription so a
// notification is written in it.

import { btn } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import type { Language } from "../../../i18n";

export function notificationsPanel(publicKey: string | undefined, lang: Language): string {
  return (
    `<section class="toolpanel" data-push-panel data-key="${esc(publicKey ?? "")}" data-lang="${esc(lang)}">` +
    `<p>When a spec needs you — a step failed or stopped, its tests went red as it was merged into main, ` +
    `or its archive is held back on unticked acceptance criteria — this device gets a notification. ` +
    `Tapping it opens the spec.</p>` +
    `<p class="muted">This is a setting of this device only. On an iPhone or iPad it works in the ` +
    `installed app, from iOS 16.4.</p>` +
    `<p class="muted" data-push-status aria-live="polite">Checking this device…</p>` +
    `<div class="configactions">` +
    btn({ id: "push-toggle", label: "Turn on", type: "button", variant: "primary", disabled: true }) +
    `</div></section>`
  );
}
