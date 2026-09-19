// Create, edit and pause a project's schedule entries — the operational
// surface around the scheduling engine in `dashboard/src/queue/schedule.ts`,
// which this file never touches. The entries live in the serving host's
// `queue-config.json` (`queue/schedule-store.ts`), so a save is a file
// write and nothing in git. Modeled on `update-settings.ts`'s
// refuse-before-write shape.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { CronExpressionParser } from "cron-parser";
import { listedModelName } from "../../queue/model-name.ts";
import { escapesRoot, SCHEDULE_NAME_RE, type ScheduleEntry } from "../../queue/schedule.ts";
import type { ScheduleStore } from "../../queue/schedule-store.ts";

export type ScheduleAdminResult = { ok: true } | { ok: false; error: string };

function saveEntries(store: ScheduleStore, project: string, entries: readonly ScheduleEntry[]): ScheduleAdminResult {
  const error = store.save(project, entries);
  return error ? { ok: false, error } : { ok: true };
}

/** Why a create/edit request cannot be saved, or `null`. Checked before
 *  any file is opened — the same "refuse before any write" rule
 *  `updateProjectSettings` follows. `excludeName` is the entry's OWN
 *  current name on an edit, so keeping (or not keeping) that same name
 *  is never mistaken for a collision with itself. */
export function scheduleEntryError(
  projectDir: string,
  req: { name?: string; cron?: string; prompt?: string; model?: string },
  existing: readonly ScheduleEntry[],
  excludeName?: string,
  /** Every model name the queue config lists. Passed by the
   *  route, which is where that table is read; absent (a caller with no
   *  config to hand) checks the name's SHAPE only. A model the queue
   *  would refuse is refused here instead, while a person is looking at
   *  the form — stored unchecked it would refuse every fire from then
   *  on, at a time nobody is watching. */
  knownModels?: readonly string[],
): string | null {
  const name = req.name?.trim();
  if (!name) return "a name is required";
  if (!SCHEDULE_NAME_RE.test(name)) {
    return `"${name}" is not a usable schedule name: letters, digits, dot, dash and underscore only, up to 64 characters`;
  }
  if (existing.some((e) => e.name === name && e.name !== excludeName)) {
    return `an entry named "${name}" already exists in this project`;
  }
  const cron = req.cron?.trim();
  if (!cron) return "a cron expression is required";
  try {
    CronExpressionParser.parse(cron);
  } catch {
    return `"${cron}" is not a valid cron expression`;
  }
  const prompt = req.prompt?.trim();
  if (!prompt) return "a prompt file path is required";
  if (escapesRoot(prompt)) return `${prompt} would leave the project root`;
  if (!existsSync(join(projectDir, prompt))) {
    return `${prompt} does not exist in this project's checkout`;
  }
  // Empty means "the configuration decides" and is never refused — the
  // same reading the queue's own request parser gives an empty model.
  const model = req.model?.trim();
  if (model) {
    if (!SCHEDULE_NAME_RE.test(model)) return `"${model}" is not a usable model name`;
    if (knownModels) {
      const listed = listedModelName(knownModels, model);
      if ("candidates" in listed) {
        return listed.candidates.length
          ? `"${model}" matches several models this dashboard offers: ${listed.candidates.join(", ")}`
          : `"${model}" is not a model this dashboard offers`;
      }
    }
  }
  return null;
}

/** The model an entry stores: the spelling the dashboard lists, when the
 *  posted one differs from it only in case. */
function storedModel(model: string | undefined, knownModels?: readonly string[]): string | undefined {
  const posted = model?.trim();
  if (!posted || !knownModels) return posted || undefined;
  const listed = listedModelName(knownModels, posted);
  return "name" in listed ? listed.name : posted;
}

/** Add a new entry, enabled by default. `projectDir` is where the prompt
 *  path is checked. */
export function createScheduleEntry(
  store: ScheduleStore,
  project: string,
  projectDir: string,
  req: { name: string; cron: string; prompt: string; model?: string },
  knownModels?: readonly string[],
): ScheduleAdminResult {
  const existing = store.list(project);
  const error = scheduleEntryError(projectDir, req, existing, undefined, knownModels);
  if (error) return { ok: false, error };
  const model = storedModel(req.model, knownModels);
  const entry: ScheduleEntry = {
    name: req.name.trim(), cron: req.cron.trim(), prompt: req.prompt.trim(), enabled: true,
    // Stamped on every save: a fire at or before this floor reads as
    // already used, so a fresh entry's first real run is its next fire
    // after the save, not whatever the cron's most recent fire already was.
    since: new Date().toISOString(),
    ...(model ? { model } : {}),
  };
  return saveEntries(store, project, [...existing, entry]);
}

/** Edit an existing entry by its current name. A rename is accepted —
 *  the entry's tracking key changes with it, and its run history under
 *  the old key is not carried across. */
export function updateScheduleEntry(
  store: ScheduleStore,
  project: string,
  projectDir: string,
  currentName: string,
  req: { name: string; cron: string; prompt: string; model?: string },
  knownModels?: readonly string[],
): ScheduleAdminResult {
  const existing = store.list(project);
  const current = existing.find((e) => e.name === currentName);
  if (!current) return { ok: false, error: `no schedule entry named "${currentName}"` };
  const error = scheduleEntryError(projectDir, req, existing, currentName, knownModels);
  if (error) return { ok: false, error };
  const model = storedModel(req.model, knownModels);
  const updated = existing.map((e) =>
    e.name === currentName
      ? {
          name: req.name.trim(), cron: req.cron.trim(), prompt: req.prompt.trim(), enabled: e.enabled,
          // Reset on every save, a bare rename included.
          since: new Date().toISOString(),
          // An edit that posts no model at all CLEARS the entry's own
          // pick, rather than keeping a value the form no longer shows:
          // the form always posts the select it drew, so an absent field
          // is a form with no model picker on it (a dashboard with no
          // models configured), and pinning one there is a promise the
          // page is not making.
          ...(model ? { model } : {}),
        }
      : e,
  );
  return saveEntries(store, project, updated);
}

/** Remove an entry entirely. A deleted entry's job history stays in the
 *  queue store under its old tracking key and is not touched here; it
 *  simply becomes unreachable through the UI once the entry it belonged
 *  to is gone. */
export function deleteScheduleEntry(store: ScheduleStore, project: string, name: string): ScheduleAdminResult {
  const existing = store.list(project);
  if (!existing.some((e) => e.name === name)) return { ok: false, error: `no schedule entry named "${name}"` };
  return saveEntries(store, project, existing.filter((e) => e.name !== name));
}

/** Pause or resume one entry: an immediate, no-confirm flip. A value
 *  that matches what is already stored writes nothing. */
export function setScheduleEnabled(
  store: ScheduleStore,
  project: string,
  name: string,
  enabled: boolean,
): ScheduleAdminResult {
  const existing = store.list(project);
  const current = existing.find((e) => e.name === name);
  if (!current) return { ok: false, error: `no schedule entry named "${name}"` };
  if (current.enabled === enabled) return { ok: true };
  return saveEntries(store, project, existing.map((e) => (e.name === name ? { ...e, enabled } : e)));
}
