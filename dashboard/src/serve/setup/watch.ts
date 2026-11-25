// The SSE watchers and the per-project spec-folder fs.watch that tells
// them to look again.

import { watch } from "node:fs";
import { discoverProjects } from "../../project/discover";
import { isEcho } from "./watch-echo.ts";
import {
  writeTo as writeToImpl,
  notifyQueueChanged as notifyQueueChangedImpl,
  notifyDeployWaiting as notifyDeployWaitingImpl,
  scheduleNotify as scheduleNotifyImpl,
  closeSpecWatchers as closeSpecWatchersImpl,
  createStreamGrowth,
  type SseWatchersContext,
} from "../sse-watchers.ts";
import type { Job } from "../../queue/queue.ts";
import type { ServerState } from "../state.ts";

export interface WatchSetup {
  watchers: Set<ReadableStreamDefaultController<Uint8Array>>;
  /** The subscribers that named phases, with their keys. */
  phaseWatchers: Map<ReadableStreamDefaultController<Uint8Array>, Set<string>>;
  /** The growth check for the runner's two-second tick, over the jobs. */
  streamGrowth: (jobs: () => Job[]) => { tick: () => void };
  specWatchers: Map<string, ReturnType<typeof watch>>;
  writeTo: (c: ReadableStreamDefaultController<Uint8Array>, text: string) => void;
  notifyQueueChanged: () => void;
  notifyDeployWaiting: () => void;
  scheduleNotify: () => void;
  closeSpecWatchers: () => void;
}

function sseWatchersContext(
  state: ServerState,
  encoder: TextEncoder,
  watchers: WatchSetup["watchers"],
  phaseWatchers: WatchSetup["phaseWatchers"],
  specWatchers: WatchSetup["specWatchers"],
): SseWatchersContext {
  return {
    encoder,
    watchers,
    phaseWatchers,
    get specWatchers() {
      return specWatchers;
    },
    readNotifySoon: () => state.notifySoon,
    writeNotifySoon: (v) => {
      state.notifySoon = v;
    },
    invalidateScan: () => {
      state.scan = null;
    },
  };
}

// Each allowed project's specs root, and nothing wider: a recursive
// watch on the projects root would fire on every `.git` internal,
// `node_modules` entry and build artefact in every checked-out
// project — the ground moving under the reader constantly, which is
// a cost to avoid.
//
// A change made before the watch opened is dropped (`isEcho`).
function watchSpecFolders(
  opts: { projectRoot?: string; specsWatch?: typeof watch },
  allowed: Set<string>,
  specWatchers: Map<string, ReturnType<typeof watch>>,
  scheduleNotify: () => void,
) {
  if (!opts.projectRoot) return;
  for (const p of discoverProjects(opts.projectRoot)) {
    if (!allowed.has(p.name)) continue;
    try {
      const openedAt = Date.now();
      const root = p.specsRoot;
      specWatchers.set(p.name, (opts.specsWatch ?? watch)(root, { recursive: true }, (_event, filename) => {
        if (!isEcho(root, filename, openedAt)) scheduleNotify();
      }));
    } catch {
      // A specs root that is missing or cannot be watched: the same
      // fail-open the git checks in this file already keep. The
      // five-second scan still catches up on the next redraw anything
      // else causes — only the "no reload needed" promise degrades.
    }
  }
}

export function setupWatch(
  opts: { projectRoot?: string; specsWatch?: typeof watch },
  allowed: Set<string>,
  state: ServerState,
): WatchSetup {
  // --- The pages that are watching --------------------------------
  //
  // One held-open response per open tab. The event is a SIGNAL and
  // describes no row: the browser already knows how to fetch a fresh
  // `#jobrows`, so `renderSpecsRows` stays the one place a row is
  // described and there is no second format to keep in step with it.
  // What travels the wire is "go and look", and, after a queue move, how
  // many specs wait for a person, for the app's icon.
  const encoder = new TextEncoder();
  const watchers = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const phaseWatchers = new Map<ReadableStreamDefaultController<Uint8Array>, Set<string>>();
  // --- A spec is a folder, and a folder changes no job -----------
  //
  // A spec created any other way — a `git pull`, a hand-run
  // `/aide-create`, a headless run's commit landing — writes a
  // directory and touches no job at all, so nothing was told and the
  // page stayed as it was until somebody reloaded it.
  const specWatchers = new Map<string, ReturnType<typeof watch>>();

  const sseWatchersCtx = sseWatchersContext(state, encoder, watchers, phaseWatchers, specWatchers);
  function writeTo(c: ReadableStreamDefaultController<Uint8Array>, text: string) {
    return writeToImpl(sseWatchersCtx, c, text);
  }
  function notifyQueueChanged() {
    return notifyQueueChangedImpl(sseWatchersCtx);
  }
  function notifyDeployWaiting() {
    return notifyDeployWaitingImpl(sseWatchersCtx);
  }
  function scheduleNotify() {
    return scheduleNotifyImpl(sseWatchersCtx);
  }
  function closeSpecWatchers() {
    return closeSpecWatchersImpl(sseWatchersCtx);
  }

  watchSpecFolders(opts, allowed, specWatchers, scheduleNotify);

  const streamGrowth = (jobs: () => Job[]) => createStreamGrowth(sseWatchersCtx, jobs);

  return { watchers, phaseWatchers, streamGrowth, specWatchers, writeTo, notifyQueueChanged, notifyDeployWaiting, scheduleNotify, closeSpecWatchers };
}
