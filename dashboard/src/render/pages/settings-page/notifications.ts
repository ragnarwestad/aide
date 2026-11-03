// The Notifications tab: one control for the device the page
// is open on. Everything the script needs rides on the panel's own
// attributes — the server's public key to subscribe with and the
// language the device reads, which is stored with its subscription so a
// notification is written in it.
//
// The switch is drawn disabled and only the script turns it on:
// subscribing a device is the browser's Push API, with no form a server
// could answer, so with script off it stays off and the status line
// keeps saying it is checking.

import { switchControl } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { t, type Language, type TranslationKey } from "../../../i18n";

export function notificationsPanel(publicKey: string | undefined, lang: Language): string {
  return (
    `<section class="toolpanel" data-push-panel data-key="${esc(publicKey ?? "")}" data-lang="${esc(lang)}"` +
    // What the script writes into the status line, in the reader's language.
    (["on", "off", "blocked", "unsupported", "failed"] as const)
      .map((k) => ` data-msg-${k}="${esc(t(lang, `settings.notifications.msg${k[0]!.toUpperCase()}${k.slice(1)}` as TranslationKey))}"`)
      .join("") +
    `>` +
    `<p>${esc(t(lang, "settings.notifications.when"))}</p>` +
    `<p class="muted">${esc(t(lang, "settings.notifications.device"))}</p>` +
    switchControl({
      id: "push-toggle", label: t(lang, "settings.notifications.toggle"),
      onWord: t(lang, "settings.notifications.on"), offWord: t(lang, "settings.notifications.off"), disabled: true,
    }) +
    `<p class="muted" data-push-status aria-live="polite">${esc(t(lang, "settings.notifications.checking"))}</p>` +
    `<p class="muted">${esc(t(lang, "settings.notifications.job"))}</p>` +
    `</section>`
  );
}
