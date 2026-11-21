import { scheduleTrackingKey } from "../../project/spec-names.ts";
import { isDue, mostRecentFireTime, scheduleRequest, type ScheduleJobRef } from "../../queue/schedule.ts";
import { enqueueRequest } from "../../queue/request/index.ts";
import { canCancelScheduleWait, replaceScheduleWait } from "../../queue/schedule-attempt";
import { logRefusal } from "../serve-helpers";
import type { ScheduleContext } from "./index.ts";

/** Fail old waits before either a scheduled fire or a quota restart. */
export function expireScheduleWaits(ctx: ScheduleContext): void {
  if (!ctx.projectRoot) return;
  const now = new Date((ctx.now ?? Date.now)());
  for (const project of ctx.allowed) {
    for (const entry of ctx.scheduleStore.list(project)) {
      const jobs = ctx.queue.list().filter((j) => j.project === project && j.specFolder === scheduleTrackingKey(entry.name));
      for (const job of jobs) {
        if (canCancelScheduleWait(job) && isDue(entry, now, [job])) replaceScheduleWait(ctx.queue, job, now.getTime());
      }
    }
  }
}

/** Does any project's scheduled job have a fire due right now, and if
 *  so enqueue it. `refreshDrift`'s shape again — a
 *  SCHEDULE, not a cache window, and nothing but this timer ever asks
 *  the question.
 *
 *  Each project's jobs are read fresh on every tick
 *  (`ctx.scheduleStore`, the `schedules` key of the queue config file),
 *  never cached: an
 *  operator who edits a cron expression sees the next tick honour it,
 *  not the next restart. Due-ness is `isDue`'s alone — this loop
 *  supplies it the queue's own job history for the entry's tracking key
 *  and nothing else.
 *
 *  A fire the queue refuses makes no job, so the entry stays due and is
 *  tried again next tick. The refusal is logged once per fire window and
 *  reason (`ctx.refusedFires`), not once per tick: a weekly entry refused
 *  for the same reason is logged again the week after, and an entry that
 *  leaves the configuration is forgotten. */
export async function refreshSchedules(ctx: ScheduleContext): Promise<void> {
  if (!ctx.projectRoot) return;
  expireScheduleWaits(ctx);
  const now = new Date((ctx.now ?? Date.now)());
  const refused = (ctx.refusedFires ??= new Map<string, string>());
  const live = new Set<string>();
  for (const project of ctx.allowed) {
    const entries = ctx.scheduleStore.list(project);
    for (const entry of entries) {
      const key = scheduleTrackingKey(entry.name);
      const memoKey = `${project}/${entry.name}`;
      live.add(memoKey);
      const jobs: ScheduleJobRef[] = ctx.queue
        .list()
        .filter((j) => j.project === project && j.specFolder === key)
        .map((j) => ({ specFolder: j.specFolder, createdAt: j.createdAt, startedAt: j.startedAt }));
      if (!isDue(entry, now, jobs)) {
        refused.delete(memoKey);
        continue;
      }
      // The entry's own model, when it names one: a whole-job pick, which
      // is what `parseJobRequest` copies onto every step of the job — and
      // a scheduled job has exactly one. An entry that names none is
      // enqueued byte for byte as before, and the config's own `schedule`
      // default decides.
      const result = enqueueRequest(ctx.queue, scheduleRequest(project, entry), "automatic");
      if (result.ok) {
        refused.delete(memoKey);
        continue;
      }
      const said = `${mostRecentFireTime(entry.cron, now)?.toISOString()}|${result.error}`;
      if (refused.get(memoKey) === said) continue;
      refused.set(memoKey, said);
      logRefusal("scheduled fire", memoKey, result.error);
    }
  }
  for (const key of refused.keys()) if (!live.has(key)) refused.delete(key);
}

