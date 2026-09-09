// The board registry (spec 388): one entry per project/specFolder,
// persisted to a small JSON sidecar the same way `pending-models.json`
// is (`src/queue/persist.ts`'s own shape) — loaded once at construction,
// kept in memory, written back on every change.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Named `status`, never `state` (which a repo-wide guard,
// test/queue/store/transitions.test.ts's REQ-6b, reserves for a QUEUE
// JOB's own state literals): a board's lifecycle is an unrelated
// concept that happens to share two of the same words ("running",
// "failed"), and the guard's naive text match cannot tell the two
// apart.
export type BoardStatus = "starting" | "running" | "failed";

export interface BoardEntry {
  branch: string;
  commit: string;
  port: number;
  /** This server's own `Bun.spawn` pid for the round script itself —
   *  known from the instant it starts, and what `stopBoard` sends
   *  `SIGTERM` to (negated, reaching the whole process group). Stays
   *  valid for the process's whole life, unlike `pid` below. */
  wrapperPid: number;
  /** The round's OWN "left running: pid $SERVER" pid, parsed from its
   *  log once it has finished seeding and draining every fixture spec.
   *  Display-only; absent for most of the "starting" window. */
  pid?: number;
  /** Set on an entry this server did not start but FOUND again after a
   *  restart (`recover.ts`): its wrapper is gone, so `wrapperPid` is
   *  the board's own process and the signal goes to it directly. */
  recovered?: boolean;
  url?: string;
  workDir: string;
  logPath: string;
  status: BoardStatus;
  error?: string;
  startedAt: string;
}

function parseBoards(raw: unknown): Record<string, BoardEntry> {
  const out: Record<string, BoardEntry> = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    if (
      typeof v.branch !== "string" ||
      typeof v.commit !== "string" ||
      typeof v.port !== "number" ||
      typeof v.wrapperPid !== "number" ||
      typeof v.workDir !== "string" ||
      typeof v.logPath !== "string" ||
      (v.status !== "starting" && v.status !== "running" && v.status !== "failed") ||
      typeof v.startedAt !== "string"
    ) {
      continue;
    }
    out[key] = {
      branch: v.branch,
      commit: v.commit,
      port: v.port,
      wrapperPid: v.wrapperPid,
      pid: typeof v.pid === "number" ? v.pid : undefined,
      recovered: v.recovered === true ? true : undefined,
      url: typeof v.url === "string" ? v.url : undefined,
      workDir: v.workDir,
      logPath: v.logPath,
      status: v.status,
      error: typeof v.error === "string" ? v.error : undefined,
      startedAt: v.startedAt,
    };
  }
  return out;
}

export class BoardStore {
  private readonly path: string | undefined;
  private readonly entries: Record<string, BoardEntry> = {};

  constructor(opts: { path?: string } = {}) {
    this.path = opts.path;
    this.load();
  }

  private key(project: string, specFolder: string): string {
    return `${project}/${specFolder}`;
  }

  get(project: string, specFolder: string): BoardEntry | undefined {
    return this.entries[this.key(project, specFolder)];
  }

  /** Every tracked board, for REQ-10's port-collision check. */
  all(): BoardEntry[] {
    return Object.values(this.entries);
  }

  /** Every tracked board WITH the project/specFolder it belongs to
   *  (REQ-3's board-wide overview) — `all()` alone drops that half of
   *  the key. Splitting on the FIRST "/" is safe: `key()` above is the
   *  only place that builds this string, and every project name is a
   *  directory entry (never containing "/") additionally constrained to
   *  letters/digits/dot/dash/underscore when added by hand
   *  (`project-admin/manifest-io.ts`'s `NAME_RE`). */
  listAll(): { project: string; specFolder: string; entry: BoardEntry }[] {
    return Object.entries(this.entries).map(([key, entry]) => {
      const slash = key.indexOf("/");
      return { project: key.slice(0, slash), specFolder: key.slice(slash + 1), entry };
    });
  }

  set(project: string, specFolder: string, entry: BoardEntry): void {
    this.entries[this.key(project, specFolder)] = entry;
    this.persist();
  }

  delete(project: string, specFolder: string): void {
    delete this.entries[this.key(project, specFolder)];
    this.persist();
  }

  private load(): void {
    if (!this.path || !existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf-8")) as unknown;
      Object.assign(this.entries, parseBoards(raw));
    } catch {
      // A malformed file starts empty, the same fail-closed rule
      // `parseQueueProjects`/`parsePendingModels` follow.
    }
  }

  private persist(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.entries, null, 2));
      renameSync(tmp, this.path);
    } catch {
      // Best effort, like every other sidecar this dashboard writes.
    }
  }
}
