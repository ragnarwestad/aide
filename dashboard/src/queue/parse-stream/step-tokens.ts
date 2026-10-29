// The tokens each marked step of a transcript used: the usage the stream reported between
// the step's marks, summed per model call, which is the unit the tool reports in.
//
//   Claude    one `assistant` event per content block, the events of one message sharing its `message.id`
//             and its `message.usage`: counted once per id, wherever its events stand.
//   opencode  one `step_finish` per model step, from its `step_start`.
//   Codex     one `turn.completed` per turn, so a step is given a turn only when the step was open
//             through the whole of it; a turn that holds the step's marks gives it nothing.
//
// A step ends where the time line ends it (`stepMarks`): at its own ending mark and at the mark of any other step.
// A step no usage can be attributed to has no entry. The sum is the four-way sum the runner
// reports for a whole step (`tokens_json` in core/scripts/lib/run-spec/turn/model-turn.sh).
import { summarizeEntries } from "./entries.ts";
import { sniff, type SummarizeOptions } from "./shared.ts";
import { markOf } from "./step-marks.ts";

/** What one model call wrote: the marks in it, and the usage it reported. */
interface Call {
  id?: string;
  /** The marks in the order written, by step. */
  marks: { key: string; ends: boolean }[];
  usage?: number;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Record<string, unknown> | undefined => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

/** Claude's `message.usage`: input, output, cache read and cache creation. */
function claudeUsage(message: Record<string, unknown> | undefined): number | undefined {
  const u = obj(message?.usage);
  if (!u) return undefined;
  return num(u.input_tokens) + num(u.output_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens);
}

/** opencode's `step_finish` tokens: input, output with reasoning, cache read and cache write. */
function opencodeUsage(part: Record<string, unknown> | undefined): number | undefined {
  const t = obj(part?.tokens);
  if (!t) return undefined;
  const cache = obj(t.cache);
  return num(t.input) + num(t.output) + num(t.reasoning) + num(cache?.read) + num(cache?.write);
}

/** Codex's `turn.completed` usage: input, output with reasoning, cached input. */
function codexUsage(usage: unknown): number | undefined {
  const u = obj(usage);
  if (!u) return undefined;
  return num(u.input_tokens) + num(u.output_tokens) + num(u.reasoning_output_tokens) + num(u.cached_input_tokens);
}

export function stepTokens(text: string, tool?: SummarizeOptions["tool"]): Map<string, number> {
  const kind = tool ?? sniff(text);
  const family = kind === "codex" ? "codex" : kind === "opencode" ? "opencode" : "claude";
  const totals = new Map<string, number>();
  let open: string | undefined;
  const add = (n: number | undefined, key = open): void => {
    if (key !== undefined && n !== undefined) totals.set(key, (totals.get(key) ?? 0) + n);
  };

  /** The marks a line holds, by the Log's own reader. */
  const marksIn = (line: string): { key: string; ends: boolean }[] => {
    if (!line.includes("Step ")) return [];
    return summarizeEntries(line, { tool: kind, whole: true, max: Infinity })
      .filter((e) => e.mark)
      .flatMap((e) => markOf(e.text) ?? []);
  };

  /** The call's usage goes to the last step it starts, else to the step open when it began: the call that
   *  opens a step and the call that closes one both count for it, wherever in the call the mark is. Then
   *  each mark sets the open step as on the time line: a started mark opens its step, any other ends it. */
  const apply = (call: Call): void => {
    const started = call.marks.findLast((m) => !m.ends)?.key;
    const seen = call.id === undefined ? undefined : counted.get(call.id);
    if (seen && call.usage === undefined) {
      // A later piece of a message already counted: its usage belongs to the last step the whole message starts.
      if (started !== undefined && started !== seen.key) {
        if (seen.key !== undefined) add(-seen.usage, seen.key);
        add(seen.usage, started);
        seen.key = started;
      }
    } else {
      const key = started ?? open;
      add(call.usage, key);
      if (seen) seen.key = key;
    }
    for (const m of call.marks) open = m.ends ? undefined : m.key;
  };
  const note = (call: Call, line: string): void => {
    call.marks.push(...marksIn(line));
  };

  let call: Call | undefined;
  const flush = (): void => {
    if (call) apply(call);
    call = undefined;
  };
  const counted = new Map<string, { usage: number; key?: string }>();
  let session: string | undefined;
  let turnOpen: string | undefined;

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let event: Record<string, unknown> | undefined;
    try {
      event = obj(JSON.parse(line));
    } catch {
      continue;
    }
    if (!event) continue;
    const type = typeof event.type === "string" ? event.type : "";

    if (family === "claude") {
      // A new invocation (the review's, a fix turn's) is a new session: the step it finds open is not its own.
      if (type === "system" && event.subtype === "init") {
        flush();
        open = undefined;
        continue;
      }
      if (type !== "assistant") continue;
      const message = obj(event.message);
      const id = typeof message?.id === "string" ? message.id : undefined;
      if (!call || id === undefined || id !== call.id) {
        flush();
        call = { id, marks: [] };
      }
      // A message whose events a subagent's came between starts a second call on the same id: its marks
      // count, its usage was counted with the first.
      if (call.usage === undefined && !(id !== undefined && counted.has(id))) {
        call.usage = claudeUsage(message);
        if (id !== undefined && call.usage !== undefined) counted.set(id, { usage: call.usage });
      }
      note(call, line);
    } else if (family === "opencode") {
      const sid = typeof event.sessionID === "string" ? event.sessionID : undefined;
      if (sid !== undefined && session !== undefined && sid !== session) {
        flush();
        open = undefined;
      }
      session = sid ?? session;
      if (type === "step_start") {
        flush();
        call = { marks: [] };
      } else if (type === "step_finish") {
        if (call) call.usage = opencodeUsage(obj(event.part));
        flush();
      } else if (call) note(call, line);
      else {
        const lone: Call = { marks: [] };
        note(lone, line);
        apply(lone);
      }
    } else if (type === "turn.started") turnOpen = open;
    else if (type === "turn.completed") {
      if (turnOpen !== undefined && open === turnOpen) add(codexUsage(event.usage), turnOpen);
      turnOpen = undefined;
    } else if (type === "item.completed") {
      const lone: Call = { marks: [] };
      note(lone, line);
      apply(lone);
    }
  }
  flush();
  return totals;
}
