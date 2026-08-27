// The handful of `let`s `createServer` used to hold directly, now on one
// object so the staged setup functions it calls (setup-watch.ts,
// setup-project-resolution.ts, setup-schedules.ts, setup-land.ts, and
// createServer's own remaining body) can all read and write the same
// mutable state without passing a getter/setter pair per field across
// every boundary. Split out of serve.ts (split serve.ts by theme,
// restructuring createServer into staged setup functions to get it
// under 500 lines).
//
// Every existing context type downstream (`HandleQueueContext`,
// `ScheduleContext`, `SseWatchersContext`, `SpecLookupContext`,
// `LandContext`, `SpecViewsContext`) still takes plain getter/setter
// functions, unchanged — this object is what those functions close
// over now instead of a bare local.

import type { QueueTarget } from "../render.ts";
import type { SpecRef } from "../project/discover.ts";
import type { Runner } from "../queue/runner.ts";

export interface Scan {
  at: number;
  targets: QueueTarget[];
  archived: string[];
  dirs: Map<string, string>;
  refs: Map<string, SpecRef>;
  /** Where each project's specs are checked out (spec 193). Off the
   *  same walk, because the landing's verification and the
   *  archived-with-an-open-branch set both ask origin about the specs
   *  repo as well as the code one — and re-walking the projects root
   *  to learn a path this scan already read would be a second answer
   *  to a settled question. */
  specsRoots: Map<string, string>;
}

export interface ServerState {
  // Project names resolve through a short-lived scan: fresh enough
  // that a new spec shows up, cheap enough for a page that refreshes.
  scan: Scan | null;
  /** `project/folder` of every ARCHIVED spec whose own `aide/<folder>`
   *  is STILL on origin in one of its two roots (spec 193).
   *
   *  Being archived used to answer "did this spec finish" with
   *  certainty. It does not: three specs reached the archive with
   *  their code sitting on a branch and every row saying done. This is
   *  the exception, and the same set answers both halves of it — which
   *  rows survive archiving on the specs list, and which archive rows
   *  carry the not-landed mark. One source, two readers.
   *
   *  Refreshed by `refreshSpecCaches` on a schedule of its own (spec
   *  208) — never inside a request, and never on the enqueue path. The
   *  filter is the BRANCH, deliberately, and not the job's
   *  `errorReason`: 146 carried no reason at all, and a stale reason on
   *  an old job would resurrect a row for a spec that is genuinely
   *  finished. */
  unlanded: string[];
  /** The SUBSET of `unlanded` that is open on purpose (spec 220): a
   *  project whose manifest says `codeLanding: pr` archives with its
   *  code branch still on origin, for as long as the review takes.
   *
   *  A subset, not a set of its own, and deliberately: every existing
   *  reader of `unlanded` goes on seeing exactly what it saw, and what
   *  splits is only what the two pages CALL it. Only when the branch is
   *  open in the CODE root alone — a specs root that still holds it is
   *  a landing that genuinely did not finish. */
  prOpen: string[];
  notifySoon: ReturnType<typeof setTimeout> | null;
  warming: boolean;
  /** Filled once `Bun.serve()` has run. A getter closing over this is
   *  never evaluated before then — `spawn` is only ever called later,
   *  from the polling `runner.tick()` timer. */
  server: { port: number | undefined } | null;
  /** Filled once the runner stage has run. Read by `scheduleCtx`, built
   *  earlier, only when a schedule timer actually fires. */
  runner: Runner | null;
}

export function createServerState(): ServerState {
  return { scan: null, unlanded: [], prOpen: [], notifySoon: null, warming: false, server: null, runner: null };
}
