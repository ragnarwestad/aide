// A used-up usage limit, as the queue sees it. A step its AI's limit
// stopped carries when it starts again (`Job.usageLimitWait`); until then
// the board starts no other queued step for that AI, and when the time
// comes it queues the stopped step again by itself.
//
// Everything here is worked out from the jobs alone, each tick, so the
// queue mirror is the one record and a restart of the board keeps it. The
// AI a job runs on is handed in (`toolOf`): this module reads neither the
// config nor the render layer.
//
// Only Claude's and Codex's readers ever end a step with `provider-limit`
// (`docs/job-states.md`), so an OpenCode or Copilot job never makes a
// wait and is never held by one made on another AI.

import type { BoardMessage } from "../../i18n/message.ts";
import type { Job, QueueStore } from "../queue.ts";
import { keyTool } from "./claude-accounts.ts";
import { providerLimit } from "./types.ts";

/** What the board waits when the AI named no reset time, and between two
 *  tries after a step started again has hit the limit once more. */
export const USAGE_LIMIT_RETRY_MS = 60 * 60 * 1000;

/** The login a job's current step runs on, as a hold key: the AI's name,
 *  and for a Claude step of a job on another account the account's
 *  directory after it (`holdKey`). */
export type ToolOf = (job: Job) => string;

type Wait = NonNullable<Job["usageLimitWait"]>;
type Left = NonNullable<Job["usageLimitLeft"]>;

const ms = (iso: string | undefined): number => (iso === undefined ? Number.NaN : Date.parse(iso));
const isoOf = (at: number): string => new Date(at).toISOString();

/** The wait a step's outcome writes on its job: the reset time the tool
 *  named when it is later than the stop, an hour after the stop when it
 *  named none or one that is not ahead. Nothing for any other outcome. */
export function usageLimitWait(
  outcome: { terminalReason?: string; providerLimit?: unknown },
  stoppedAt: string,
): { usageLimitWait?: Wait } {
  if (outcome.terminalReason !== "provider-limit") return {};
  const stop = ms(stoppedAt);
  const reset = ms(providerLimit(outcome.providerLimit)?.resetsAt);
  if (reset > stop) return { usageLimitWait: { until: isoOf(reset), resetKnown: true } };
  return { usageLimitWait: { until: isoOf(stop + USAGE_LIMIT_RETRY_MS), resetKnown: false } };
}

/** A stopped job the board will start again. */
const isWaiting = (job: Job): boolean =>
  job.state === "stopped" && job.stopReason === "provider-limit" && Number.isFinite(ms(job.usageLimitWait?.until));

/** A job started again with no reset time to go on, whose step has not
 *  ended yet: no result exists at the index the probe recorded. */
const isProbeOut = (job: Job): boolean =>
  (job.state === "queued" || job.state === "running") &&
  job.usageLimitProbe !== undefined &&
  job.results.length <= job.usageLimitProbe.results;

/** A step the probe sent ahead that stopped on the limit again: what it
 *  reports is the AI's newest word, and the placeholder waits the other
 *  stopped steps were given at the probe no longer count. */
const probeStoppedAgain = (job: Job): boolean =>
  job.usageLimitProbe !== undefined &&
  job.results[job.usageLimitProbe.results]?.terminalReason === "provider-limit" &&
  ms(job.finishedAt) >= ms(job.usageLimitProbe.at);

/** The wait that decides when a login's stopped steps start again: the
 *  latest of its waits, the ones a press left behind included. */
function decidingWait(waiting: readonly Job[], left: readonly Left[]): { until: number; known: boolean } {
  const again = waiting.filter(probeStoppedAgain);
  const waits = [...(again.length > 0 ? again : waiting).map((w) => w.usageLimitWait!), ...left];
  return { until: Math.max(...waits.map((w) => ms(w.until))), known: waits.every((w) => w.resetKnown) };
}

interface AiHold {
  waiting: Job[];
  /** The waits a press left on this login when it moved a step off it. They
   *  hold the login's queued steps but are never queued again. */
  left: Left[];
  probe?: Job;
  /** When the hold began: the earliest stop it holds for. */
  since: number;
}

/** Every login that is held right now. A login is held while one of its
 *  steps waits for a reset, while a step moved off it left its wait behind,
 *  or while the one step sent ahead of the others is still running. */
function heldAis(jobs: readonly Job[], toolOf: ToolOf): Map<string, AiHold> {
  const holds = new Map<string, AiHold>();
  const of = (tool: string): AiHold => {
    let hold = holds.get(tool);
    if (!hold) holds.set(tool, (hold = { waiting: [], left: [], since: Number.POSITIVE_INFINITY }));
    return hold;
  };
  for (const job of jobs) {
    for (const left of [job.usageLimitLeft, ...(job.usageLimitLeftBefore ?? [])]) {
      if (!left || !Number.isFinite(ms(left.until))) continue;
      const hold = of(left.hold);
      hold.left.push(left);
      if (Number.isFinite(ms(left.since))) hold.since = Math.min(hold.since, ms(left.since));
    }
    if (isWaiting(job)) {
      const hold = of(toolOf(job));
      hold.waiting.push(job);
      const stopped = ms(job.finishedAt);
      if (Number.isFinite(stopped)) hold.since = Math.min(hold.since, stopped);
    } else if (isProbeOut(job)) {
      const hold = of(toolOf(job));
      hold.probe = job;
      hold.since = Math.min(hold.since, ms(job.usageLimitProbe!.since));
    }
  }
  return holds;
}

/** What the held sentence names: the AI, and the account when the job is on
 *  one. The key carries the account's directory, which is never shown. */
const named = (job: Job, key: string): { tool: string; account?: string } => ({
  tool: keyTool(key),
  ...(key.includes(":") && job.claudeAccount ? { account: job.claudeAccount.name } : {}),
});

/** Every queued job a used-up usage limit holds, by id, with the sentence
 *  it is held with. Never held: the step sent ahead of the others, a job
 *  a person pressed after the hold began, and a job whose own landing is
 *  in flight. */
export function usageLimitHolds(jobs: readonly Job[], toolOf: ToolOf): Map<string, BoardMessage> {
  const held = new Map<string, BoardMessage>();
  const holds = heldAis(jobs, toolOf);
  if (holds.size === 0) return held;
  for (const job of jobs) {
    if (job.state !== "queued" || job.landing) continue;
    const tool = toolOf(job);
    const hold = holds.get(tool);
    if (!hold || hold.probe?.id === job.id) continue;
    if (job.pressed && ms(job.createdAt) > hold.since) continue;
    if (hold.probe) {
      held.set(job.id, { key: "runner.usageLimitHeldProbe", values: { ...named(job, tool), at: hold.probe.usageLimitProbe!.at } });
    } else {
      const deciding = decidingWait(hold.waiting, hold.left);
      const key = deciding.known ? "runner.usageLimitHeld" : "runner.usageLimitHeldNoReset";
      held.set(job.id, { key, values: { ...named(job, tool), at: isoOf(deciding.until) } });
    }
  }
  return held;
}

/** The AI a finished probe's step ran on: the step it recorded a result
 *  for, which the job may have moved past since. */
function probedTool(job: Job, toolOf: ToolOf): string {
  const step = job.results[job.usageLimitProbe!.results]?.step;
  const index = step ? job.steps.indexOf(step) : -1;
  return toolOf(index >= 0 ? { ...job, stepIndex: index } : job);
}

/** Queue a stopped step again. Only the step sent ahead of the others
 *  gets a probe record. */
function queueAgain(store: QueueStore, job: Job, probeAt?: string): void {
  store.transition(job.id, "limit-reset", {
    usageLimitWait: undefined,
    stopReason: undefined,
    finishedAt: undefined,
    error: undefined,
    errorDetail: undefined,
    errorReason: undefined,
    ...(probeAt ? { usageLimitProbe: { results: job.results.length, at: probeAt, since: job.finishedAt ?? probeAt } } : {}),
  });
}

/** Queue stopped steps again once their AI's limit has reset. Run first on
 *  every tick, so a job moved back to `queued` is started by the same one.
 *
 *  For each AI with waiting jobs and no probe running:
 *  - a waiting job a person has pressed a step for since its stop stands
 *    down at its time, and is not started again;
 *  - a job whose landing is in flight is left for the next tick;
 *  - a wait a press left on the login (`usageLimitLeft`) holds its queued
 *    steps like a waiting one's, and is dropped at its time;
 *  - after a probe of that AI has ended without a usage-limit stop, every
 *    job that stopped before the probe is queued again at once;
 *  - otherwise, at the AI's time, all are queued again when every reset
 *    time was known, and when one was not only the oldest is, as the
 *    probe, while the others wait an hour from now. */
export function restartAfterUsageLimit(store: QueueStore, toolOf: ToolOf, now: number): void {
  // A wait a press left behind is over at its time and holds nothing after.
  for (const job of store.list()) {
    if (!job.usageLimitLeft && !job.usageLimitLeftBefore) continue;
    const live = (l: Left) => ms(l.until) > now;
    const all = [job.usageLimitLeft, ...(job.usageLimitLeftBefore ?? [])].filter((l): l is Left => !!l);
    if (all.every(live)) continue;
    const [latest, ...before] = all.filter(live);
    store.update(job.id, { usageLimitLeft: latest, usageLimitLeftBefore: before.length ? before : undefined });
  }
  const jobs = store.list();
  const nowIso = isoOf(now);
  for (const [tool, hold] of heldAis(jobs, toolOf)) {
    if (hold.probe) continue;
    let waiting = hold.waiting.filter((w) => {
      if (ms(w.usageLimitWait!.until) > now) return true;
      const stopped = ms(w.finishedAt);
      const step = w.steps[w.stepIndex];
      const handled = jobs.some(
        (j) =>
          j.id !== w.id && j.project === w.project && j.specFolder === w.specFolder && ms(j.createdAt) > stopped &&
          j.steps.includes(step!),
      );
      if (handled) store.update(w.id, { usageLimitWait: undefined });
      return !handled;
    });
    waiting = waiting.filter((w) => !w.landing);
    if (waiting.length === 0) continue;

    const probes = jobs.filter(
      (j) =>
        j.usageLimitProbe !== undefined &&
        j.results.length > j.usageLimitProbe.results &&
        j.results[j.usageLimitProbe.results]?.terminalReason !== "provider-limit" &&
        probedTool(j, toolOf) === tool,
    );
    const released = waiting.filter((w) => probes.some((p) => ms(p.usageLimitProbe!.at) > ms(w.finishedAt)));
    if (released.length > 0) {
      for (const w of released) queueAgain(store, w);
      continue;
    }

    const deciding = decidingWait(waiting, hold.left);
    if (now < deciding.until) continue;
    if (deciding.known) {
      for (const w of waiting) queueAgain(store, w);
      continue;
    }
    const [oldest, ...rest] = [...waiting].sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
    queueAgain(store, oldest!, nowIso);
    for (const w of rest) {
      store.update(w.id, { usageLimitWait: { until: isoOf(now + USAGE_LIMIT_RETRY_MS), resetKnown: false } });
    }
  }
}
