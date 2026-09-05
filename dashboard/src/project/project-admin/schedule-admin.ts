// Create, edit and pause a project's schedule entries (spec 276) — the
// operational surface around the scheduling engine in
// `dashboard/src/queue/schedule.ts`, which this file never touches.
// Modeled on `update-settings.ts`'s changed-only-write,
// refuse-before-write shape.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CronExpressionParser } from "cron-parser";
import type { GitRunner } from "../../git/branch-status.ts";
import { lastCommitOf } from "../../git/description-freshness.ts";
import { saveSpecFile } from "../../git/specs-pull.ts";
import { escapesRoot, parseManifest, SCHEDULE_NAME_RE, type ScheduleEntry } from "../parse-manifest.ts";
import { scheduleListText } from "./manifest-io.ts";

export type ScheduleAdminResult = { ok: true } | { ok: false; error: string };

/** What every schedule write needs from git: how to run a command, and
 *  how to resolve a checkout's default branch — the same shape
 *  `saveSpecFile`'s other callers (`spec-page.ts`, `checks.ts`) already
 *  build from `ctx.gitRun`/`ctx.branchStatus.defaultBranch`. */
export interface ScheduleGit {
  run: GitRunner;
  resolveBase: (root: string) => Promise<string | null>;
}

const MANIFEST_FILE = join(".aide", "project.yaml");

/** Every schedule write's git identity: what the commit says, and how
 *  the commit-and-push is asked for. Reuses `saveSpecFile` (spec 162)
 *  exactly as REQ-2 asks — the same commit/push/rollback contract a
 *  spec-file Save already gets, over `.aide/project.yaml` in the
 *  project's own CODE checkout instead of a spec folder in the specs
 *  one. The CALLER (`schedule-admin-routes.ts`) is responsible for the
 *  `mergeLock` around this, exactly as `spec-page.ts`/`checks.ts` wrap
 *  their own `saveSpecFiles` calls — this function only knows how to
 *  save, not how to serialize against a landing or a Settings pull
 *  sharing the same checkout root. */
async function saveEntries(
  git: ScheduleGit,
  projectDir: string,
  entries: readonly ScheduleEntry[],
  message: string,
): Promise<ScheduleAdminResult> {
  const path = manifestPath(projectDir);
  const currentText = existsSync(path) ? readFileSync(path, "utf-8") : "";
  let text: string;
  try {
    text = scheduleListText(currentText, entries);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const current = await lastCommitOf(git.run, projectDir, MANIFEST_FILE);
  const result = await saveSpecFile(git.run, projectDir, git.resolveBase, {
    file: MANIFEST_FILE, text, baseSha: current?.sha ?? null, specLabel: "schedule", message,
  });
  return result.ok ? { ok: true } : { ok: false, error: result.note };
}

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
export async function createScheduleEntry(
  git: ScheduleGit,
  projectDir: string,
  req: { name: string; cron: string; prompt: string; model?: string },
  knownModels?: readonly string[],
): Promise<ScheduleAdminResult> {
  const existing = readEntries(projectDir);
  const error = scheduleEntryError(projectDir, req, existing, undefined, knownModels);
  if (error) return { ok: false, error };
  const model = req.model?.trim();
  const entry: ScheduleEntry = {
    name: req.name.trim(), cron: req.cron.trim(), prompt: req.prompt.trim(), enabled: true,
    ...(model ? { model } : {}),
  };
  return saveEntries(git, projectDir, [...existing, entry], `Add schedule entry "${entry.name}" from the dashboard`);
}

/** Edit an existing entry by its current name. A rename is accepted —
 *  the entry's tracking key changes with it, and its run history under
 *  the old key is not carried across (acceptance criterion 17). */
export async function updateScheduleEntry(
  git: ScheduleGit,
  projectDir: string,
  currentName: string,
  req: { name: string; cron: string; prompt: string; model?: string },
  knownModels?: readonly string[],
): Promise<ScheduleAdminResult> {
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
  return saveEntries(git, projectDir, updated, `Edit schedule entry "${req.name.trim()}" from the dashboard`);
}

/** Remove an entry entirely (spec 277). Manifest state only — a
 *  deleted entry's job history stays in the queue store under its old
 *  tracking key and is not touched here; it simply becomes unreachable
 *  through the UI once the entry it belonged to is gone. */
export async function deleteScheduleEntry(
  git: ScheduleGit,
  projectDir: string,
  name: string,
): Promise<ScheduleAdminResult> {
  const existing = readEntries(projectDir);
  const current = existing.find((e) => e.name === name);
  if (!current) return { ok: false, error: `no schedule entry named "${name}"` };
  const updated = existing.filter((e) => e.name !== name);
  return saveEntries(git, projectDir, updated, `Delete schedule entry "${name}" from the dashboard`);
}

/** Pause or resume one entry — no `confirm` field required, unlike the
 *  spec page's own Reset route: this is an immediate, no-confirm flip
 *  (acceptance criterion 8). A value that matches what is already
 *  stored writes nothing, the same changed-only rule every other
 *  project-admin write follows. */
export async function setScheduleEnabled(
  git: ScheduleGit,
  projectDir: string,
  name: string,
  enabled: boolean,
): Promise<ScheduleAdminResult> {
  const existing = readEntries(projectDir);
  const current = existing.find((e) => e.name === name);
  if (!current) return { ok: false, error: `no schedule entry named "${name}"` };
  if (current.enabled === enabled) return { ok: true };
  const updated = existing.map((e) => (e.name === name ? { ...e, enabled } : e));
  const verb = enabled ? "Enable" : "Disable";
  return saveEntries(git, projectDir, updated, `${verb} schedule entry "${name}" from the dashboard`);
}
