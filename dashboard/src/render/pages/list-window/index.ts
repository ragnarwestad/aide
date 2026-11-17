/** A list window is a contiguous prefix of the current matching identities.
 * Opened exceptions never change its boundary. */
export const BATCH_SIZE = 100;

export function windowLimit(requested?: string): number {
  if (!requested || !/^\d+$/.test(requested)) return BATCH_SIZE;
  const count = Number(requested);
  return Number.isSafeInteger(count) && count >= BATCH_SIZE && count % BATCH_SIZE === 0 ? count : BATCH_SIZE;
}

export function windowQuery(path: string, filter: Record<string, unknown>): string {
  return JSON.stringify([path, ...["q", "project", "state", "kind", "sort", "dir"].map((key) => String(filter[key] ?? "").trim())]);
}

export interface WindowRequest {
  limit?: string;
  boundary?: string;
  loaded?: string;
  grow?: boolean;
  query?: string;
  previousQuery?: string;
  opened?: ReadonlySet<string>;
}
export interface ListWindow<T> {
  rows: T[];
  requested: number;
  loaded: number;
  total: number;
  boundary?: string;
  hasMore: boolean;
  query?: string;
}

export function selectWindow<T extends { key: string }>(rows: readonly T[], request: WindowRequest = {}): ListWindow<T> {
  const reset = request.previousQuery !== undefined && request.query !== request.previousQuery;
  const requested = reset ? BATCH_SIZE : windowLimit(request.limit);
  const boundary = reset ? -1 : rows.findIndex((row) => row.key === request.boundary);
  const accepted = !reset && request.loaded && /^\d+$/.test(request.loaded) && Number.isSafeInteger(Number(request.loaded)) ? Number(request.loaded) : 0;
  const previous = Math.max(BATCH_SIZE, accepted, requested - (request.grow ? BATCH_SIZE : 0), boundary + 1);
  const count = request.grow && !reset ? previous + BATCH_SIZE : Math.max(requested, accepted, boundary + 1);
  const loaded = Math.min(rows.length, count);
  return {
    rows: rows.filter((row, index) => index < loaded || request.opened?.has(row.key)),
    requested, loaded, total: rows.length, boundary: rows[loaded - 1]?.key,
    hasMore: loaded < rows.length, query: request.query,
  };
}
