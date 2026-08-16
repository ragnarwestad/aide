// Enrichment of stored aide runs with claude-usage's /api/live rows
// (spec 80): ONE fetch carries state, agents[] and sessionCostUSD per
// session. Lazy and cached — the fetch runs only when rows() is asked
// for, so this server never drives claude-usage's live fold (and its
// notifications) on a timer. Unreachable → rows degrade, never throw.

import type { AideRunStore, StoredRun } from "./aide-run-store.ts";

export type LiveState = "unknown" | "not-live" | string;

export interface RunRow extends StoredRun {
  live: LiveState;
  subagents: number | null;
  costUsd: number | null;
  enriched: boolean;
}

interface LiveSession {
  sessionId?: string;
  state?: string;
  agents?: unknown[];
  sessionCostUSD?: number;
}

interface LiveAnswer {
  hosts?: { sessions?: LiveSession[] }[];
}

export interface EnricherOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  ttlMs?: number;
  timeoutMs?: number;
}

export class LiveEnricher {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private cache: { at: number; sessions: Map<string, LiveSession> | null } | null = null;

  constructor(opts: EnricherOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? fetch;
    this.ttlMs = opts.ttlMs ?? 5000;
    this.timeoutMs = opts.timeoutMs ?? 1500;
  }

  private async sessions(): Promise<Map<string, LiveSession> | null> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < this.ttlMs) return this.cache.sessions;
    let sessions: Map<string, LiveSession> | null = null;
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/live`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.ok) {
        const body = (await res.json()) as LiveAnswer;
        sessions = new Map();
        for (const host of body.hosts ?? []) {
          for (const s of host.sessions ?? []) {
            if (s.sessionId) sessions.set(s.sessionId, s);
          }
        }
      }
    } catch {
      sessions = null;
    }
    this.cache = { at: now, sessions };
    return sessions;
  }

  /** One session, for a page that is about one job (spec 02). Shares
   *  this enricher's cache and its degrade-never-throw discipline:
   *  claude-usage unreachable answers "unknown", never an error. */
  async lookup(sessionId: string): Promise<{
    state: LiveState;
    subagents: number | null;
    costUsd: number | null;
    enriched: boolean;
  }> {
    const sessions = await this.sessions();
    if (!sessions) return { state: "unknown", subagents: null, costUsd: null, enriched: false };
    const s = sessions.get(sessionId);
    if (!s) return { state: "not-live", subagents: null, costUsd: null, enriched: true };
    return {
      state: s.state ?? "live",
      subagents: Array.isArray(s.agents) ? s.agents.length : 0,
      costUsd: typeof s.sessionCostUSD === "number" ? s.sessionCostUSD : null,
      enriched: true,
    };
  }

  async rows(store: AideRunStore): Promise<{ rows: RunRow[]; enriched: boolean }> {
    const sessions = await this.sessions();
    const enriched = sessions !== null;
    const rows = store.list().map((run): RunRow => {
      if (!sessions) return { ...run, live: "unknown", subagents: null, costUsd: null, enriched: false };
      const s = sessions.get(run.sessionId);
      if (!s) return { ...run, live: "not-live", subagents: null, costUsd: null, enriched: true };
      return {
        ...run,
        live: s.state ?? "live",
        subagents: Array.isArray(s.agents) ? s.agents.length : 0,
        costUsd: typeof s.sessionCostUSD === "number" ? s.sessionCostUSD : null,
        enriched: true,
      };
    });
    return { rows, enriched };
  }
}
