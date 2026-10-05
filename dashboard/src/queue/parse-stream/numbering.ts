// Where a Codex stream's items stand, counted the way a session file counts
// them, so a spawn found in the session file can be put where the session
// made it. `codex exec --json` has no line for the spawn itself, and its
// items carry no number a session file shares; the three kinds below are
// the ones both show, item for item, up to every spawn (codex-cli 0.148.0
// to 0.160.0).
import { codexKind, events, type ItemNumbering } from "./shared.ts";

const NUMBERED = new Set(["agent_message", "command_execution", "file_change"]);

/** A reader of a stream's events that keeps the count. */
export function itemCounter(from?: ItemNumbering) {
  const state: ItemNumbering = { thread: from?.thread, counts: { ...from?.counts } };
  const started: string[] = [];
  return {
    state,
    /** Threads a `thread.started` event named while reading. */
    started,
    /** One event: the place of the numbered item it completes, if it completes one. */
    read(event: Record<string, unknown>): { thread: string; n: number } | undefined {
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        state.thread = event.thread_id;
        started.push(event.thread_id);
        return undefined;
      }
      const item = event.item;
      if (event.type !== "item.completed" || item === null || typeof item !== "object" || Array.isArray(item)) return undefined;
      if (!NUMBERED.has(codexKind(item as Record<string, unknown>)) || state.thread === undefined) return undefined;
      const n = (state.counts[state.thread] ?? 0) + 1;
      state.counts[state.thread] = n;
      return { thread: state.thread, n };
    },
  };
}

/** Where the numbering stands after `text`, and the threads it named. */
export function codexNumbering(text: string, from?: ItemNumbering): ItemNumbering & { started: string[] } {
  const counter = itemCounter(from);
  for (const event of events(text)) counter.read(event);
  return { ...counter.state, started: counter.started };
}
