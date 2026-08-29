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
  req: { name?: string; cron?: string; prompt?: string },
  existing: readonly ScheduleEntry[],
  excludeName?: string,
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
  return null;
}

/** Add a new entry, enabled by default (acceptance criteria 5, 6, 7). */
export function createScheduleEntry(
  projectDir: string,
  req: { name: string; cron: string; prompt: string },
): ScheduleAdminResult {
  const existing = readEntries(projectDir);
  const error = scheduleEntryError(projectDir, req, existing);
  if (error) return { ok: false, error };
  const entry: ScheduleEntry = { name: req.name.trim(), cron: req.cron.trim(), prompt: req.prompt.trim(), enabled: true };
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
  req: { name: string; cron: string; prompt: string },
): ScheduleAdminResult {
  const existing = readEntries(projectDir);
  const current = existing.find((e) => e.name === currentName);
  if (!current) return { ok: false, error: `no schedule entry named "${currentName}"` };
  const error = scheduleEntryError(projectDir, req, existing, currentName);
  if (error) return { ok: false, error };
  const updated = existing.map((e) =>
    e.name === currentName
      ? { name: req.name.trim(), cron: req.cron.trim(), prompt: req.prompt.trim(), enabled: e.enabled }
      : e,
  );
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
