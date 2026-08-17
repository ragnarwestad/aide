// The aide-run store (spec 80): one row per session, keyed on
// sessionId (a later command in the same session replaces the row —
// that is how the phase advances). LRU-capped, mirrored to a JSON file
// (write-then-rename) and reloaded on boot so restarts keep the runs.
// The payload schema is written down here and nowhere else.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const AIDE_COMMANDS = [
  "explore", "create", "analyze", "review-plan", "implement", "archive",
  "manifest", "make-tests", "to-pdf", "to-html", "react-class-to-func",
] as const;
export type AideCommand = (typeof AIDE_COMMANDS)[number];

// The three TDD phases and nothing else: a typo must not reach the
// page as if it were a phase (spec 81, criterion 10).
export const TDD_PHASES = ["red", "green", "refactor"] as const;
export type TddPhase = (typeof TDD_PHASES)[number];

const HOST_RE = /^[A-Za-z0-9._-]{1,64}$/;
const SESSION_RE = /^[A-Za-z0-9._-]{1,128}$/;
const SHORT_RE = /^[A-Za-z0-9._-]{1,64}$/;

export interface AideRun {
  host: string;
  sessionId: string;
  command: AideCommand;
  spec?: string;
  project?: string;
  /** Reported from inside an /aide-implement run, at each TDD phase
   *  boundary. The row is keyed on the session, so a later phase
   *  replaces the earlier one rather than adding a line. */
  phase?: TddPhase;
  capturedAt?: string;
}

export interface StoredRun extends AideRun {
  receivedAt: string;
}

export type ParseResult =
  | { ok: true; run: AideRun }
  | { ok: false; error: string };

function optShort(v: unknown, name: string): string | undefined | Error {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || !SHORT_RE.test(v)) return new Error(`invalid ${name}`);
  return v;
}

// Unknown fields are IGNORED (claude-usage's parser precedent);
// missing or invalid required fields are rejected.
export function parseAideRun(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body is not an object" };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.host !== "string" || !HOST_RE.test(r.host)) return { ok: false, error: "invalid host" };
  if (typeof r.sessionId !== "string" || !SESSION_RE.test(r.sessionId)) {
    return { ok: false, error: "invalid sessionId" };
  }
  if (typeof r.command !== "string" || !(AIDE_COMMANDS as readonly string[]).includes(r.command)) {
    return { ok: false, error: "invalid command" };
  }
  const spec = optShort(r.spec, "spec");
  if (spec instanceof Error) return { ok: false, error: spec.message };
  const project = optShort(r.project, "project");
  if (project instanceof Error) return { ok: false, error: project.message };
  let phase: TddPhase | undefined;
  if (r.phase !== undefined && r.phase !== null) {
    if (typeof r.phase !== "string" || !(TDD_PHASES as readonly string[]).includes(r.phase)) {
      return { ok: false, error: "invalid phase" };
    }
    phase = r.phase as TddPhase;
  }
  let capturedAt: string | undefined;
  if (r.capturedAt !== undefined && r.capturedAt !== null) {
    const d = new Date(r.capturedAt as string | number);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "invalid capturedAt" };
    capturedAt = d.toISOString();
  }
  const run: AideRun = { host: r.host, sessionId: r.sessionId, command: r.command as AideCommand };
  if (spec) run.spec = spec;
  if (project) run.project = project;
  if (phase) run.phase = phase;
  if (capturedAt) run.capturedAt = capturedAt;
  return { ok: true, run };
}

export interface StoreOptions {
  cap?: number;
  mirrorPath?: string;
}

export class AideRunStore {
  private readonly runs = new Map<string, StoredRun>(); // insertion order = LRU order
  private readonly cap: number;
  private readonly mirrorPath?: string;

  constructor(opts: StoreOptions = {}) {
    this.cap = opts.cap ?? 512;
    this.mirrorPath = opts.mirrorPath;
    this.load();
  }

  put(run: AideRun, receivedAt: string): StoredRun {
    const stored: StoredRun = { ...run, receivedAt };
    this.runs.delete(run.sessionId); // re-insert at the end (most recent)
    this.runs.set(run.sessionId, stored);
    while (this.runs.size > this.cap) {
      const oldest = this.runs.keys().next().value as string;
      this.runs.delete(oldest);
    }
    this.mirror();
    return stored;
  }

  list(): StoredRun[] {
    return [...this.runs.values()].reverse(); // newest first
  }

  private load(): void {
    if (!this.mirrorPath || !existsSync(this.mirrorPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.mirrorPath, "utf-8")) as unknown;
      if (!Array.isArray(raw)) return;
      for (const entry of raw) {
        const parsed = parseAideRun(entry);
        if (!parsed.ok) continue;
        const receivedAt =
          typeof (entry as { receivedAt?: unknown }).receivedAt === "string"
            ? (entry as { receivedAt: string }).receivedAt
            : new Date(0).toISOString();
        this.runs.set(parsed.run.sessionId, { ...parsed.run, receivedAt });
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
      writeFileSync(tmp, JSON.stringify([...this.runs.values()], null, 2));
      renameSync(tmp, this.mirrorPath);
    } catch {
      // mirroring is best effort
    }
  }
}
