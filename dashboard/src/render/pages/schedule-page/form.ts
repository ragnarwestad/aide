// The shared create/edit form (spec 276): same markup both for a brand
// new entry and for editing an existing one, pre-filled on edit. The
// Cron field's "Next run" line is computed here for the no-script
// baseline and kept live by `schedule-actions.ts` (Phase 6) through the
// `data-cron-next` hook below — a debounced fetch against
// `GET /api/queue/schedule/cron-next` patches this element's text as
// the field changes.
import { nextFireTime } from "../../../queue/schedule.ts";
import { btn, field, tokenField } from "../../ui/components.ts";
import { esc } from "../../ui/html.ts";

export interface ScheduleFormOptions {
  /** Present when editing; absent when creating — decides the submit
   *  label and nothing else, since both cases post to their own
   *  `action`. */
  entryName?: string;
  entry?: { name: string; cron: string; prompt: string };
  action: string;
  token?: string;
  error?: string;
}

export const CRON_NEXT_HOOK = "cron-next";

export function renderScheduleForm(opts: ScheduleFormOptions): string {
  const e = opts.entry;
  const initialNext = e?.cron ? nextFireTime(e.cron, new Date()) : null;
  return (
    `<form method="post" action="${esc(opts.action)}" class="scheduleform" data-cron-preview-url="/api/queue/schedule/cron-next">` +
    tokenField(opts.token) +
    `<p class="rowmsg warn scheduleform-error" aria-live="polite">${opts.error ? esc(opts.error) : ""}</p>` +
    field("Name", `<input type="text" name="name" required maxlength="64" value="${esc(e?.name ?? "")}">`) +
    field(
      "Cron",
      `<input type="text" name="cron" required class="cron-input" value="${esc(e?.cron ?? "")}">` +
        `<span class="cron-next muted" data-${CRON_NEXT_HOOK}>` +
        (initialNext ? `Next run: ${esc(initialNext.toISOString())}` : "") +
        `</span>`,
    ) +
    field(
      "Prompt file path",
      `<input type="text" name="prompt" required value="${esc(e?.prompt ?? "")}">`,
    ) +
    `<div class="factions">${btn({ label: opts.entryName ? "Save" : "Create", variant: "primary" })}</div>` +
    `</form>`
  );
}
