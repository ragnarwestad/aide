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
import { defaultModelForTool, modelOptions, resolveChosenModel, TOOL_NAMES, type QueuePageOptions } from "../queue-list.ts";

export interface ScheduleFormOptions {
  /** Present when editing; absent when creating — decides the submit
   *  label and nothing else, since both cases post to their own
   *  `action`. */
  entryName?: string;
  entry?: { name: string; cron: string; prompt: string; model?: string };
  action: string;
  token?: string;
  error?: string;
  /** Present only on the New-job form (spec 278): every allowed
   *  project, offered as a `<select>` the same way the New-spec form's
   *  own Project field is (`new-spec-page.ts`). The Edit form on an
   *  entry's own detail page keeps its project fixed from the URL and
   *  never passes this. */
  projects?: readonly string[];
  /** Every model the config granted a budget to, and which CLI each
   *  starts — the same view the spec list's phase lines and the
   *  New-spec form are given, built by the same helper in `serve.ts` so
   *  no two pages come to offer different lists. Absent or empty draws
   *  no picker at all, exactly as the New-spec form does. */
  modelChoices?: QueuePageOptions["modelChoices"];
  /** What the configuration would give each step. Only `schedule`'s own
   *  entry (or the table's `default`) can matter here: a scheduled job
   *  runs that one step. */
  defaultModels?: QueuePageOptions["defaultModels"];
}

/** The form's own id. Both selects are written INSIDE the form, so the
 *  `form` attribute is not what submits them — it is what pairs them:
 *  `applyAiPick` (`queue-client/ai-sync.ts`) finds a model select by its
 *  `name` and its form id together, the same pairing the New-spec form
 *  and the phase lines use. */
export const SCHEDULE_FORM_ID = "schedule-form";

/** The AI and the model this entry's fires run on — ONE pair, not one
 *  per phase: a scheduled job is a single `schedule` step, so there is
 *  nothing here for a per-phase choice to differ about.
 *
 *  Everything about it is the New-spec form's own model field
 *  (`new-spec-page.ts`), which is what "the same way as on the Specs
 *  page" means: every model drawn and grouped by tool, the AI select
 *  drawn only where there are two tools to tell apart, each AI option
 *  carrying the model it fills in (worked out HERE, from the
 *  configuration, never in the browser), and the select PRE-FILLED with
 *  what the entry is actually on — its own saved pick, else what the
 *  configuration would give the `schedule` step. */
function modelFields(opts: ScheduleFormOptions): string {
  const models = opts.modelChoices ?? [];
  if (!models.length) return "";
  const configured = opts.defaultModels?.schedule ?? opts.defaultModels?.default;
  const chosen = resolveChosenModel(models, configured, opts.entry?.model);
  const tools = Object.keys(TOOL_NAMES).filter((tool) => models.some((m) => (m.tool ?? "claude") === tool));
  const restingTool = models.find((m) => m.name === chosen)?.tool ?? "claude";
  const aiSelect =
    tools.length > 1
      ? `<noscript><style>[data-ai]{display:none}</style></noscript>` +
        `<select data-ai="model" form="${SCHEDULE_FORM_ID}">` +
        tools
          .map(
            (tool) =>
              `<option value="${esc(tool)}"` +
              ` data-default="${esc(defaultModelForTool(models, tool, configured) ?? "")}"` +
              `${tool === restingTool ? " selected" : ""}>${esc(TOOL_NAMES[tool]!)}</option>`,
          )
          .join("") +
        `</select>`
      : "";
  // The two side by side in ONE grid item, not one per column track.
  // `.scheduleform` is a two-column grid whose tracks are sized by Cron
  // and Prompt file path, so a field dropped straight into it lands
  // under one of those — which put the AI at the far left and the model
  // an input's width away from it. They belong together, in the order
  // they are read, the way the phase lines and the New-spec form already
  // have them (2026-08-31).
  return (
    `<span class="row">` +
    (aiSelect ? field("AI", aiSelect) : "") +
    field("Model", `<select name="model" form="${SCHEDULE_FORM_ID}">` + modelOptions(models, chosen) + `</select>`) +
    `</span>`
  );
}

export const CRON_NEXT_HOOK = "cron-next";

export function renderScheduleForm(opts: ScheduleFormOptions): string {
  const e = opts.entry;
  const initialNext = e?.cron ? nextFireTime(e.cron, new Date()) : null;
  const models = modelFields(opts);
  return (
    `<form method="post" action="${esc(opts.action)}" class="scheduleform" id="${SCHEDULE_FORM_ID}" ` +
    `data-cron-preview-url="/api/queue/schedule/cron-next">` +
    tokenField(opts.token) +
    `<p class="rowmsg failed scheduleform-error" aria-live="polite">${opts.error ? esc(opts.error) : ""}</p>` +
    `<div class="frow">` +
    (opts.projects
      ? field(
          "Project",
          `<select name="project">` + opts.projects.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("") + `</select>`,
        )
      : "") +
    field("Name", `<input type="text" name="name" required maxlength="64" value="${esc(e?.name ?? "")}">`) +
    `</div>` +
    `<div class="frow">` +
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
    `</div>` +
    // The bottom line, under Cron and Prompt and above the button: what
    // a fire runs on is one statement about the whole entry, not a
    // detail of either field over it. No `.frow` wrapper — that one is
    // `display: contents`, which would hand the grid the two fields
    // separately again; this row is one item, in the first column.
    models +
    `<div class="factions">${btn({ label: opts.entryName ? "Save" : "Create", variant: "primary" })}</div>` +
    `</form>`
  );
}
