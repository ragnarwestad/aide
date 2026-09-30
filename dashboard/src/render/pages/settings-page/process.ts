// The Process tab: how many steps the queue may run at once. The form
// carries `data-settings-form` and the `settingsform` Save/Cancel pair,
// so the page's script posts it without a reload exactly as it posts the
// models table — the page draws one panel at a time, so the two never
// share a page.

import { btn, messageSlot } from "../../ui/components";

/** What the tab shows. `min` and `max` travel with it because this layer
 *  may not import the rule from `src/serve`, where it lives. */
export interface ProcessSettings {
  /** The count the running queue uses right now. */
  concurrency: number;
  /** This machine's cores, as a guide beside the field. */
  cores: number;
  min: number;
  max: number;
}

export function processPanel(s: ProcessSettings): string {
  return (
    `<form id="settings-form" class="settingsform" data-settings-form method="post" action="/api/queue/settings/concurrency">` +
    messageSlot("refused", "failed") +
    messageSlot("notice", "info") +
    `<p><label for="process-concurrency">Steps that may run at once</label> ` +
    `<input id="process-concurrency" type="number" name="concurrency" min="${s.min}" max="${s.max}" step="1" value="${s.concurrency}"></p>` +
    `<p class="muted">This machine has ${s.cores} cores. A saved number is used from the next step the queue ` +
    `starts; a step already running is never stopped for it.</p>` +
    `<div class="configactions">` +
    btn({ id: "settingsform-save", label: "Save", variant: "primary", pending: "saving…" }) +
    btn({ id: "settingsform-cancel", label: "Cancel", type: "button", disabled: true }) +
    `</div></form>`
  );
}
