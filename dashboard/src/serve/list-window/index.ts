import type { Job } from "../../queue/queue.ts";
import type { QueueRowView, SpecsFilter } from "../../render";
import { selectWindow, windowQuery, type ListWindow } from "../../render/pages/list-window";

/** Only the queue facts global grouping and ordering need. Provider names,
 * live transcripts and queue positions belong to the selected-row builder. */
export function summaryJob(job: Job): QueueRowView {
  return {
    ...job, timeoutSec: 0, model: undefined,
    results: job.results.map((result) => ({
      step: result.step, ok: result.ok, costUsd: result.costUsd, costMeasured: result.costMeasured,
      at: result.at, startedAt: result.startedAt, terminalReason: result.terminalReason,
      tokens: result.tokens?.total,
    })),
  } as QueueRowView;
}

export function requestWindow<T extends { key: string }>(rows: T[], url: URL, filter: SpecsFilter, opened = new Set<string>()): ListWindow<T> {
  return selectWindow(rows, {
    limit: url.searchParams.get("limit") ?? undefined,
    boundary: url.searchParams.get("boundary") ?? undefined,
    grow: url.searchParams.get("grow") === "1",
    previousQuery: url.searchParams.get("windowQuery") ?? undefined,
    query: windowQuery(url.pathname.startsWith("/specs") ? "/specs" : "/", filter as Record<string, unknown>),
    opened,
  });
}

/** Queue records are replaced on update. A changed scan or execution group
 * also invalidates the metadata used to choose the range. */
export function listSnapshot(ctx: {
  queue: { list: () => Job[]; executionGroups: { list: () => unknown[] } };
  readScan: () => { archived: string[]; at?: number } | null;
}, jobs: Job[]): () => boolean {
  const scanAt = ctx.readScan()?.at;
  const groups = JSON.stringify(ctx.queue.executionGroups.list());
  return () => {
    const current = ctx.queue.list();
    return ctx.readScan()?.at === scanAt && current.length === jobs.length && current.every((job, i) => job === jobs[i]) && JSON.stringify(ctx.queue.executionGroups.list()) === groups;
  };
}
