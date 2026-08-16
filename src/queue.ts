// The queue store (spec 81, slice 81a): one record per job, in the
// shape aide-run-store.ts established — a written-down schema with
// unknown fields ignored, an LRU cap, a mirror written-then-renamed and
// reloaded on boot. No scheduler here: 81a stores and shows jobs, 81b
// runs them.
//
// Two properties are security, not tidiness:
//   * a request carries NAMES, never paths — the server resolves the
//     project itself against the discovered, allowlisted set
//   * a request may only TIGHTEN a cap, and cannot set the permission
//     mode at all; widening what an unattended run may do is not
//     something an HTTP body gets to decide

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const WORKFLOW_STEPS = [
  "explore", "create", "analyze", "review-plan", "implement", "archive", "manifest",
] as const;
export type WorkflowStep = (typeof WORKFLOW_STEPS)[number];

export const JOB_STATES = [
  "queued", "running", "awaiting-approval", "done",
  "stopped", "failed", "cancelled", "interrupted",
] as const;
export type JobState = (typeof JOB_STATES)[number];

// Why a run ended early. `stopped` is deliberately not `failed`: with
// tight caps a cap-stop is a common, healthy outcome, and a reader who
// cannot tell it from a broken agent will start ignoring both.
export type StopReason = "budget" | "timeout";

export interface StepResult {
  step: WorkflowStep;
  ok: boolean;
  costUsd: number;
  costMeasured: boolean;
  terminalReason: string;
  subtype?: string;
  sessionId?: string;
  at: string;
}

export interface Job {
  id: string;
  project: string;
  specFolder: string;
  steps: WorkflowStep[];
  gateAfter: WorkflowStep[];
  stepIndex: number;
  state: JobState;
  budgetUsd: number;
  jobCapUsd: number;
  timeoutSec: number;
  permissionMode: Record<string, string>;
  model: Record<string, string>;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  pid?: number;
  pgid?: number;
  resultFile?: string;
  results: StepResult[];
  spentUsd: number;
  /** Where the work can be read: the compare page for the spec's
   *  branch, or the pull request when the push mode opened one. */
  branchUrl?: string;
  stopReason?: StopReason;
  error?: string;
}

export interface QueueDefaults {
  budgetUsd: number;
  jobCapUsd: number;
  dailyCapUsd: number;
  timeoutSec: number;
  /** Per step, with a `default` fallback. Config-only — see the header. */
  permissionMode: Record<string, string>;
  model: Record<string, string>;
}

/** Resolves a project NAME to its real spec folders, or null if it is
 *  not both discovered and allowlisted. */
export type ProjectResolver = (project: string) => { specFolders: string[] } | null;

export type ParseResult = { ok: true; job: Job } | { ok: false; error: string };

const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const FOLDER_RE = /^[A-Za-z0-9._-]{1,128}$/;

function perStep<T>(steps: WorkflowStep[], table: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const s of steps) out[s] = table[s] ?? table.default;
  return out;
}

// A cap override is accepted only when it is stricter than the config.
function tighten(raw: unknown, limit: number, name: string): number | Error {
  if (raw === undefined || raw === null) return limit;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return new Error(`invalid ${name}`);
  if (raw > limit) return new Error(`${name} may only be tightened (max ${limit})`);
  return raw;
}

export function parseJobRequest(
  raw: unknown,
  opts: { resolve: ProjectResolver; defaults: QueueDefaults },
): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body is not an object" };
  }
  const r = raw as Record<string, unknown>;
  const { defaults } = opts;

  if (typeof r.project !== "string" || !NAME_RE.test(r.project)) return { ok: false, error: "invalid project" };
  const resolved = opts.resolve(r.project);
  if (!resolved) return { ok: false, error: `unknown or not-allowed project: ${r.project}` };

  if (typeof r.specFolder !== "string" || !FOLDER_RE.test(r.specFolder)) {
    return { ok: false, error: "invalid specFolder" };
  }
  if (!resolved.specFolders.includes(r.specFolder)) {
    return { ok: false, error: `unknown specFolder: ${r.specFolder}` };
  }

  if (!Array.isArray(r.steps) || r.steps.length === 0 || r.steps.length > 8) {
    return { ok: false, error: "steps must be a list of 1-8 workflow steps" };
  }
  const steps: WorkflowStep[] = [];
  for (const s of r.steps) {
    if (typeof s !== "string" || !(WORKFLOW_STEPS as readonly string[]).includes(s)) {
      return { ok: false, error: `invalid entry in steps: ${String(s)}` };
    }
    steps.push(s as WorkflowStep);
  }

  // Default: every step gates. A job may be posted with an empty list
  // to run straight through.
  let gateAfter: WorkflowStep[] = [...steps];
  if (r.gateAfter !== undefined && r.gateAfter !== null) {
    if (!Array.isArray(r.gateAfter)) return { ok: false, error: "gateAfter must be a list" };
    gateAfter = [];
    for (const g of r.gateAfter) {
      if (typeof g !== "string" || !steps.includes(g as WorkflowStep)) {
        return { ok: false, error: `gateAfter names a step not in this job: ${String(g)}` };
      }
      gateAfter.push(g as WorkflowStep);
    }
  }

  const budgetUsd = tighten(r.budgetUsd, defaults.budgetUsd, "budgetUsd");
  if (budgetUsd instanceof Error) return { ok: false, error: budgetUsd.message };
  const jobCapUsd = tighten(r.jobCapUsd, defaults.jobCapUsd, "jobCapUsd");
  if (jobCapUsd instanceof Error) return { ok: false, error: jobCapUsd.message };
  const timeoutSec = tighten(r.timeoutSec, defaults.timeoutSec, "timeoutSec");
  if (timeoutSec instanceof Error) return { ok: false, error: timeoutSec.message };

  return {
    ok: true,
    job: {
      id: crypto.randomUUID(),
      project: r.project,
      specFolder: r.specFolder,
      steps,
      gateAfter,
      stepIndex: 0,
      state: "queued",
      budgetUsd,
      jobCapUsd,
      timeoutSec,
      permissionMode: perStep(steps, defaults.permissionMode),
      model: perStep(steps, defaults.model),
      createdAt: new Date().toISOString(),
      results: [],
      spentUsd: 0,
    },
  };
}

// A job read back from the mirror. Looser than a request (it carries
// id/state/results), but still validated: a corrupt row is dropped, not
// trusted.
function parseStoredJob(raw: unknown): Job | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.project !== "string" || !NAME_RE.test(r.project)) return null;
  if (typeof r.specFolder !== "string" || !FOLDER_RE.test(r.specFolder)) return null;
  if (!Array.isArray(r.steps) || r.steps.some((s) => !(WORKFLOW_STEPS as readonly string[]).includes(s as string))) {
    return null;
  }
  if (typeof r.state !== "string" || !(JOB_STATES as readonly string[]).includes(r.state)) return null;
  return {
    ...(r as unknown as Job),
    steps: r.steps as WorkflowStep[],
    gateAfter: Array.isArray(r.gateAfter) ? (r.gateAfter as WorkflowStep[]) : [],
    results: Array.isArray(r.results) ? (r.results as StepResult[]) : [],
    spentUsd: typeof r.spentUsd === "number" ? r.spentUsd : 0,
    stepIndex: typeof r.stepIndex === "number" ? r.stepIndex : 0,
  };
}

// Caps and per-step policy belong in a file on the machine that runs
// the jobs, never in the code: a number that turns out wrong should
// cost a config edit and a restart, not a release.
export function mergeQueueDefaults(base: QueueDefaults, raw: unknown): QueueDefaults {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return base;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
  const table = (v: unknown, fallback: Record<string, string>) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return fallback;
    const out: Record<string, string> = { ...fallback };
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "string" && val) out[k] = val;
    }
    return out;
  };
  return {
    budgetUsd: num(r.budgetUsd, base.budgetUsd),
    jobCapUsd: num(r.jobCapUsd, base.jobCapUsd),
    dailyCapUsd: num(r.dailyCapUsd, base.dailyCapUsd),
    timeoutSec: num(r.timeoutSec, base.timeoutSec),
    permissionMode: table(r.permissionMode, base.permissionMode),
    model: table(r.model, base.model),
  };
}

export interface QueueOptions {
  defaults: QueueDefaults;
  resolve: ProjectResolver;
  mirrorPath?: string;
  cap?: number;
}

export class QueueStore {
  private readonly jobs = new Map<string, Job>(); // insertion order = age order
  private readonly cap: number;
  private readonly mirrorPath?: string;
  readonly defaults: QueueDefaults;
  private readonly resolve: ProjectResolver;

  constructor(opts: QueueOptions) {
    this.cap = opts.cap ?? 200;
    this.mirrorPath = opts.mirrorPath;
    this.defaults = opts.defaults;
    this.resolve = opts.resolve;
    this.load();
  }

  enqueue(raw: unknown): ParseResult {
    const parsed = parseJobRequest(raw, { resolve: this.resolve, defaults: this.defaults });
    if (!parsed.ok) return parsed;
    this.jobs.set(parsed.job.id, parsed.job);
    while (this.jobs.size > this.cap) {
      this.jobs.delete(this.jobs.keys().next().value as string);
    }
    this.mirror();
    return parsed;
  }

  list(): Job[] {
    return [...this.jobs.values()].reverse(); // newest first
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  update(id: string, patch: Partial<Job>): Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const next = { ...job, ...patch };
    this.jobs.set(id, next);
    this.mirror();
    return next;
  }

  private load(): void {
    if (!this.mirrorPath || !existsSync(this.mirrorPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.mirrorPath, "utf-8")) as unknown;
      if (!Array.isArray(raw)) return;
      for (const entry of raw) {
        const job = parseStoredJob(entry);
        if (job) this.jobs.set(job.id, job);
      }
    } catch {
      // a corrupt mirror is not worth crashing over — start empty
    }
  }

  private mirror(): void {
    if (!this.mirrorPath) return;
    try {
      mkdirSync(dirname(this.mirrorPath), { recursive: true });
      const tmp = `${this.mirrorPath}.tmp`;
      writeFileSync(tmp, JSON.stringify([...this.jobs.values()], null, 2));
      renameSync(tmp, this.mirrorPath);
    } catch {
      // mirroring is best effort
    }
  }
}
