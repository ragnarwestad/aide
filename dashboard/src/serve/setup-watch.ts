// The SSE watchers and the per-project spec-folder fs.watch that tells
// them to look again.

import { watch } from "node:fs";
import { discoverProjects } from "../project/discover.ts";
import {
  writeTo as writeToImpl,
  notifyQueueChanged as notifyQueueChangedImpl,
  scheduleNotify as scheduleNotifyImpl,
  closeSpecWatchers as closeSpecWatchersImpl,
  type SseWatchersContext,
} from "./sse-watchers.ts";
import type { ServerState } from "./state.ts";

export interface WatchSetup {
  watchers: Set<ReadableStreamDefaultController<Uint8Array>>;
  specWatchers: Map<string, ReturnType<typeof watch>>;
  writeTo: (c: ReadableStreamDefaultController<Uint8Array>, text: string) => void;
  notifyQueueChanged: () => void;
  scheduleNotify: () => void;
  closeSpecWatchers: () => void;
}

export function setupWatch(
  opts: { projectRoot?: string },
  allowed: Set<string>,
  state: ServerState,
): WatchSetup {
  // --- spec 189: the pages that are watching --------------------------------
  //
  // One held-open response per open tab. The event is a SIGNAL and
  // carries nothing: the browser already knows how to fetch a fresh
  // `#jobrows`, so `renderQueueRows` stays the one place a row is
  // described and there is no second format to keep in step with it.
  // What travels the wire is "go and look".
  const encoder = new TextEncoder();
  const watchers = new Set<ReadableStreamDefaultController<Uint8Array>>();
  // --- spec 204: a spec is a folder, and a folder changes no job -----------
  //
  // A spec created any other way — a `git pull`, a hand-run
  // `/aide-create`, a headless run's commit landing — writes a
  // directory and touches no job at all, so nothing was told and the
  // page stayed as it was until somebody reloaded it.
  const specWatchers = new Map<string, ReturnType<typeof watch>>();

  const sseWatchersCtx: SseWatchersContext = {
    encoder,
    watchers,
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
  function writeTo(c: ReadableStreamDefaultController<Uint8Array>, text: string) {
    return writeToImpl(sseWatchersCtx, c, text);
  }
  function notifyQueueChanged() {
    return notifyQueueChangedImpl(sseWatchersCtx);
  }
  function scheduleNotify() {
    return scheduleNotifyImpl(sseWatchersCtx);
  }
  function closeSpecWatchers() {
    return closeSpecWatchersImpl(sseWatchersCtx);
  }

  // Each allowed project's specs root, and nothing wider: a recursive
  // watch on the projects root would fire on every `.git` internal,
  // `node_modules` entry and build artefact in every checked-out
  // project — the ground moving under the reader constantly, which is
  // the cost spec 189 already removed once.
  //
  // One echo comes with it, and is deliberately left alone: FSEvents
  // hands a fresh recursive watcher the changes made in the
  // milliseconds before it opened, so a server started right after
  // something wrote in a specs root broadcasts once at start-up. A page
  // open at that moment redraws once — which a reconnect already does —
  // and a page opened afterwards never hears it.
  if (opts.projectRoot) {
    for (const p of discoverProjects(opts.projectRoot)) {
      if (!allowed.has(p.name)) continue;
      try {
        specWatchers.set(p.name, watch(p.specsRoot, { recursive: true }, scheduleNotify));
      } catch {
        // A specs root that is missing or cannot be watched: the same
        // fail-open the git checks in this file already keep. The
        // five-second scan still catches up on the next redraw anything
        // else causes — only the "no reload needed" promise degrades.
      }
    }
  }

  return { watchers, specWatchers, writeTo, notifyQueueChanged, scheduleNotify, closeSpecWatchers };
}
