// Create, edit and pause a project's schedule entries (spec 276) — the
// operational surface around the scheduling engine in
// `dashboard/src/queue/schedule.ts`, which this file never touches.
// Modeled on `update-settings.ts`'s changed-only-write,
// refuse-before-write shape.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CronExpressionParser } from "cron-parser";
import { escapesRoot, parseManifest, SCHEDULE_NAME_RE, type ScheduleEntry } from "../parse-manifest.ts";
import { writeScheduleList } from "./manifest-io.ts";

export type ScheduleAdminResult = { ok: true } | { ok: false; error: string };

function manifestPath(projectDir: string): string {
  return join(projectDir, ".aide", "project.yaml");
}

function readEntries(projectDir: string): ScheduleEntry[] {
  const file = manifestPath(projectDir);
  if (!existsSync(file)) return [];
  const parsed = parseManifest(readFileSync(file, "utf-8"));
  return parsed.ok ? [...(parsed.data.schedule ?? [])] : [];
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
  /** Every model name the queue config grants a budget to. Passed by the
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
    if (knownModels && !knownModels.includes(model)) {
      return `"${model}" is not a model this dashboard offers`;
    }
  }
  return null;
}

/** Add a new entry, enabled by default (acceptance criteria 5, 6, 7). */
export function createScheduleEntry(
  projectDir: string,
  req: { name: string; cron: string; prompt: string; model?: string },
  knownModels?: readonly string[],
): ScheduleAdminResult {
  const existing = readEntries(projectDir);
  const error = scheduleEntryError(projectDir, req, existing, undefined, knownModels);
  if (error) return { ok: false, error };
  const model = req.model?.trim();
  const entry: ScheduleEntry = {
    name: req.name.trim(), cron: req.cron.trim(), prompt: req.prompt.trim(), enabled: true,
    ...(model ? { model } : {}),
  };
  try {
    writeScheduleList(manifestPath(projectDir), [...existing, entry]);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true };
}

/** Edit an existing entry by its current name. A rename is accepted —
 *  the entry's tracking key changes with it, and its run history under
 *  the old key is not carried across (acceptance criterion 17). */
export function updateScheduleEntry(
  projectDir: string,
  currentName: string,
  req: { name: string; cron: string; prompt: string; model?: string },
  knownModels?: readonly string[],
): ScheduleAdminResult {
  const existing = readEntries(projectDir);
  const current = existing.find((e) => e.name === currentName);
  if (!current) return { ok: false, error: `no schedule entry named "${currentName}"` };
  const error = scheduleEntryError(projectDir, req, existing, currentName, knownModels);
  if (error) return { ok: false, error };
  const model = req.model?.trim();
  const updated = existing.map((e) =>
    e.name === currentName
      ? {
          name: req.name.trim(), cron: req.cron.trim(), prompt: req.prompt.trim(), enabled: e.enabled,
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
  try {
    writeScheduleList(manifestPath(projectDir), updated);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true };
}

/** Remove an entry entirely (spec 277). Manifest state only — a
 *  deleted entry's job history stays in the queue store under its old
 *  tracking key and is not touched here; it simply becomes unreachable
 *  through the UI once the entry it belonged to is gone. */
export function deleteScheduleEntry(projectDir: string, name: string): ScheduleAdminResult {
  const existing = readEntries(projectDir);
  const current = existing.find((e) => e.name === name);
  if (!current) return { ok: false, error: `no schedule entry named "${name}"` };
  const updated = existing.filter((e) => e.name !== name);
  try {
    writeScheduleList(manifestPath(projectDir), updated);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true };
}

/** Pause or resume one entry — no `confirm` field required, unlike the
 *  spec page's own Reset route: this is an immediate, no-confirm flip
 *  (acceptance criterion 8). A value that matches what is already
 *  stored writes nothing, the same changed-only rule every other
 *  project-admin write follows. */
export function setScheduleEnabled(projectDir: string, name: string, enabled: boolean): ScheduleAdminResult {
  const existing = readEntries(projectDir);
  const current = existing.find((e) => e.name === name);
  if (!current) return { ok: false, error: `no schedule entry named "${name}"` };
  if (current.enabled === enabled) return { ok: true };
  const updated = existing.map((e) => (e.name === name ? { ...e, enabled } : e));
  try {
    writeScheduleList(manifestPath(projectDir), updated);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true };
}
