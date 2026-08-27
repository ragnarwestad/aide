// Everything the queue writes to disk outside the mirror itself: the
// project allowlist, the workflow defaults, and reading a stored job
// back.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { applyEdits, modify, parse } from "jsonc-parser";
import { JOB_STATES, WORKFLOW_STEPS, type WorkflowStep } from "./steps.ts";
import { mergeBranchRefs, type BranchRef, type Job, type ModelChoice, type QueueDefaults, type StepResult } from "./types.ts";
import { FOLDER_RE, NAME_RE } from "./parse-request.ts";

// A job read back from the mirror. Looser than a request (it carries
// id/state/results), but still validated: a corrupt row is dropped, not
// trusted.
export function parseStoredJob(raw: unknown): Job | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.project !== "string" || !NAME_RE.test(r.project)) return null;
  if (typeof r.specFolder !== "string" || !FOLDER_RE.test(r.specFolder)) return null;
  if (!Array.isArray(r.steps) || r.steps.some((s) => !(WORKFLOW_STEPS as readonly string[]).includes(s as string))) {
    return null;
  }
  if (typeof r.state !== "string" || !(JOB_STATES as readonly string[]).includes(r.state)) return null;
  // Spec 149: a record written before the stop between steps was removed
  // still carries `gateAfter`. Left behind HERE rather than overwritten
  // below, because the spread is what would otherwise carry it straight
  // back out into the next mirror. A record whose STATE is the retired
  // one fails the check above and is dropped whole — the rule a corrupt
  // row has always had, and the three jobs it can apply to finished in
  // August.
  const { gateAfter: _retired, ...kept } = r;
  return {
    ...(kept as unknown as Job),
    steps: r.steps as WorkflowStep[],
    results: Array.isArray(r.results) ? (r.results as StepResult[]) : [],
    spentUsd: typeof r.spentUsd === "number" ? r.spentUsd : 0,
    // Undefined, never 0, when the mirror has no figure: the page shows
    // a dash for a job nothing measured, and a zero is a claim.
    spentTokens: typeof r.spentTokens === "number" ? r.spentTokens : undefined,
    stepIndex: typeof r.stepIndex === "number" ? r.stepIndex : 0,
    // Anything but a string here would be handed to a fetch and to a
    // file read. Dropped, like every other malformed field.
    sessionId: typeof r.sessionId === "string" ? r.sessionId : undefined,
    streamFile: typeof r.streamFile === "string" ? r.streamFile : undefined,
    // Each `root` here becomes a git working directory on the merge
    // path, so a malformed entry is dropped rather than carried — the
    // same rule the two fields above already follow.
    branchUrls: Array.isArray(r.branchUrls) ? mergeBranchRefs([], r.branchUrls as BranchRef[]) : undefined,
    // Dropped on purpose. `landing` marks a merge in flight in THIS
    // process; a mirror read back after a restart has no such call behind
    // it, and the flag holds the whole queue shut for as long as it is
    // set — so a restored one would wedge it with nothing left to clear.
    landing: undefined,
  };
}

/** The project allowlist, as it is written in `queue-config.json`.
 *
 *  It used to be a `--queue-projects` argument baked into the launchd
 *  plist, so adding a project cost a plist re-render, an scp and a
 *  `launchctl bootout`/`bootstrap` — which is why adding one was four
 *  hand steps rather than a button (spec 112). Reading it from the
 *  config file the server ALREADY reads makes the change survive a
 *  restart without any of that; the CLI flag stays as the seed for a
 *  first install, where no config file exists yet.
 *
 *  `null` for anything malformed, so the caller keeps the flag rather
 *  than silently running with a shorter list — an empty ARRAY is a real
 *  answer ("nothing may be queued") and is returned as one. Each name is
 *  checked with the same rule a job's project is: these become directory
 *  names under the projects root. */
export function parseQueueProjects(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (!raw.every((p) => typeof p === "string" && NAME_RE.test(p) && !p.includes(".."))) return null;
  return raw as string[];
}

/** Write the allowlist back, keeping everything else in the file.
 *
 *  `projects` is passed in from the server's live `Set` — never read
 *  back out of the file and edited — so two changes in immediate
 *  succession cannot lose each other: each write carries the whole
 *  current answer, and the write itself is synchronous, which on one JS
 *  thread is what stops two of them interleaving. The other keys are
 *  read first because they are not ours to drop, and they are the one
 *  part a concurrent write could clobber — a risk taken deliberately
 *  over the alternative of this route owning the whole file's schema.
 *
 *  Written-then-renamed, exactly as `QueueStore.mirror()` does it: a
 *  half-written config is a server that comes up with no allowlist.
 *  Returns why it could not be written, or `null`. */
export function persistQueueProjects(file: string, projects: string[]): string | null {
  try {
    let raw: Record<string, unknown> = {};
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        raw = parsed as Record<string, unknown>;
      }
    }
    raw.projects = [...projects];
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(raw, null, 2));
    renameSync(tmp, file);
    return null;
  } catch (err) {
    return `could not write ${file}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export interface QueueSettingsUpdate {
  model: Record<string, string>;
  budgetUsd: number;
  jobCapUsd: number;
  timeoutSec: Record<string, number>;
}

/** Atomically replace the dashboard-owned workflow defaults while leaving
 * comments, formatting, the fallback and future model keys intact. */
export function persistQueueSettings(file: string, next: QueueSettingsUpdate): string | null {
  try {
    if (!existsSync(file)) return `could not write ${file}: file does not exist`;
    let source = readFileSync(file, "utf-8");
    const errors: { error: number; offset: number; length: number }[] = [];
    const raw = parse(source, errors, { allowTrailingComma: true }) as unknown;
    if (errors.length || raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return `could not write ${file}: invalid JSONC configuration`;
    }
    const opts = { formattingOptions: { insertSpaces: true, tabSize: 2 } };
    for (const [step, model] of Object.entries(next.model)) {
      source = applyEdits(source, modify(source, ["model", step], model, opts));
    }
    source = applyEdits(source, modify(source, ["budgetUsd"], next.budgetUsd, opts));
    source = applyEdits(source, modify(source, ["jobCapUsd"], next.jobCapUsd, opts));
    for (const [step, sec] of Object.entries(next.timeoutSec)) {
      source = applyEdits(source, modify(source, ["timeoutSec", step], sec, opts));
    }
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, source);
    renameSync(tmp, file);
    return null;
  } catch (err) {
    return `could not write ${file}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Caps and per-step policy belong in a file on the machine that runs
// the jobs, never in the code: a number that turns out wrong should
// cost a config edit and a restart, not a release.
export function mergeQueueDefaults(base: QueueDefaults, raw: unknown): QueueDefaults {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return base;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
  // The numeric sibling of `table` below: `timeoutSec` is per step since
  // spec 152, and a file still carrying the old flat number is dropped
  // in favour of the built-in defaults rather than crashing — the same
  // direction every other malformed key here fails in.
  const numTable = (v: unknown, fallback: Record<string, number>) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return fallback;
    const out: Record<string, number> = { ...fallback };
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "number" && Number.isFinite(val) && val > 0) out[k] = val;
    }
    return out;
  };
  const table = (v: unknown, fallback: Record<string, string>) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return fallback;
    const out: Record<string, string> = { ...fallback };
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "string" && val) out[k] = val;
    }
    return out;
  };
  // A malformed entry is DROPPED, not defaulted: a model whose budget
  // is a typo would otherwise silently inherit the general one, and the
  // whole point of listing it is that its number is different.
  const choices = (v: unknown): Record<string, ModelChoice> | undefined => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return base.modelChoices;
    const out: Record<string, ModelChoice> = {};
    for (const [name, entry] of Object.entries(v as Record<string, unknown>)) {
      if (!NAME_RE.test(name) || entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.budgetUsd !== "number" || !Number.isFinite(e.budgetUsd) || e.budgetUsd <= 0) continue;
      const cap =
        typeof e.jobCapUsd === "number" && Number.isFinite(e.jobCapUsd) && e.jobCapUsd > 0
          ? e.jobCapUsd
          : undefined;
      // A malformed `tool` or `model` drops that FIELD, not the whole
      // entry: the budget is still a real grant, and an entry that
      // loses its tool falls back to claude — which is the default
      // every other entry already has.
      const choice: ModelChoice = cap === undefined
        ? { budgetUsd: e.budgetUsd }
        : { budgetUsd: e.budgetUsd, jobCapUsd: cap };
      if (e.tool === "claude" || e.tool === "codex") choice.tool = e.tool;
      if (typeof e.model === "string" && e.model) choice.model = e.model;
      out[name] = choice;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };

  return {
    budgetUsd: num(r.budgetUsd, base.budgetUsd),
    jobCapUsd: num(r.jobCapUsd, base.jobCapUsd),
    dailyCapUsd: num(r.dailyCapUsd, base.dailyCapUsd),
    timeoutSec: numTable(r.timeoutSec, base.timeoutSec),
    permissionMode: table(r.permissionMode, base.permissionMode),
    model: table(r.model, base.model),
    modelChoices: choices(r.modelChoices),
  };
}
