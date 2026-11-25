// The tokens each marked step of a transcript used: the usage the stream reported between
// the step's marks, summed per model call, which is the unit the tool reports in.
//
//   Claude    one `assistant` event per content block, the events of one message sharing its `message.id`
//             and its `message.usage`: counted once per id, wherever its events stand.
//   opencode  one `step_finish` per model step, from its `step_start`.
//   Codex     one `turn.completed` per turn, carrying its thread's usage so far: a turn counts what it
//             grew by since the thread's last turn. A step is given a turn only when the step was open
//             through the whole of it; a turn that holds the step's marks gives it nothing.
//
// A step ends where the time line ends it (`stepMarks`): at its own ending mark and at the mark of any other step.
// A step no usage can be attributed to has no entry. The sum is the four-way sum the runner
// reports for a whole step (`tokens_json` in core/scripts/lib/run-spec/turn/model-turn/index.sh).
import { summarizeEntries } from "./entries.ts";
import { transcriptFormat, type SummarizeOptions } from "./shared.ts";
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

/** Codex's `turn.completed` usage: its thread's so far, every turn of it. The input holds the cached input
 *  and the output the reasoning, so the whole is input plus output, as Codex's own `total_tokens` is. */
function codexUsage(usage: unknown): number | undefined {
  const u = obj(usage);
  if (!u) return undefined;
  return num(u.input_tokens) + num(u.output_tokens);
}

/** The tokens of one step's transcript, counted per step mark as the
 *  events go by. */
class StepTokenCounter {
  readonly totals = new Map<string, number>();
  private open: string | undefined;
  private call: Call | undefined;
  private readonly counted = new Map<string, { usage: number; key?: string }>();
  private session: string | undefined;
  private turnOpen: string | undefined;
  // Each Codex thread's usage at its last turn, and the thread the transcript is in now.
  private readonly threadSoFar = new Map<string, number>();
  private thread = "";

  constructor(private readonly kind: ReturnType<typeof transcriptFormat>) {}

  private add(n: number | undefined, key = this.open): void {
    if (key !== undefined && n !== undefined) this.totals.set(key, (this.totals.get(key) ?? 0) + n);
  }

  /** The marks a line holds, by the Log's own reader. */
  private marksIn(line: string): { key: string; ends: boolean }[] {
    if (!line.includes("Step ")) return [];
    return summarizeEntries(line, { tool: this.kind, whole: true, max: Infinity })
      .filter((e) => e.mark)
      .flatMap((e) => markOf(e.text) ?? []);
  }

  /** The call's usage goes to the last step it starts, else to the step open when it began: the call that
   *  opens a step and the call that closes one both count for it, wherever in the call the mark is. Then
   *  each mark sets the open step as on the time line: a started mark opens its step, any other ends it. */
  private apply(call: Call): void {
    const started = call.marks.findLast((m) => !m.ends)?.key;
    const seen = call.id === undefined ? undefined : this.counted.get(call.id);
    if (seen && call.usage === undefined) {
      // A later piece of a message already counted: its usage belongs to the last step the whole message starts.
      if (started !== undefined && started !== seen.key) {
        if (seen.key !== undefined) this.add(-seen.usage, seen.key);
        this.add(seen.usage, started);
        seen.key = started;
      }
    } else {
      const key = started ?? this.open;
      this.add(call.usage, key);
      if (seen) seen.key = key;
    }
    for (const m of call.marks) this.open = m.ends ? undefined : m.key;
  }

  private note(call: Call, line: string): void {
    call.marks.push(...this.marksIn(line));
  }

  /** A line that is a call of its own. */
  private lone(line: string): void {
    const lone: Call = { marks: [] };
    this.note(lone, line);
    this.apply(lone);
  }

  flush(): void {
    if (this.call) this.apply(this.call);
    this.call = undefined;
  }

  claude(event: Record<string, unknown>, type: string, line: string): void {
    // A new invocation (the review's, a fix turn's) is a new session: the step it finds open is not its own.
    if (type === "system" && event.subtype === "init") {
      this.flush();
      this.open = undefined;
      return;
    }
    if (type !== "assistant") return;
    const message = obj(event.message);
    const id = typeof message?.id === "string" ? message.id : undefined;
    if (!this.call || id === undefined || id !== this.call.id) {
      this.flush();
      this.call = { id, marks: [] };
    }
    const call = this.call;
    // A message whose events a subagent's came between starts a second call on the same id: its marks
    // count, its usage was counted with the first.
    if (call.usage === undefined && !(id !== undefined && this.counted.has(id))) {
      call.usage = claudeUsage(message);
      if (id !== undefined && call.usage !== undefined) this.counted.set(id, { usage: call.usage });
    }
    this.note(call, line);
  }

  opencode(event: Record<string, unknown>, type: string, line: string): void {
    const sid = typeof event.sessionID === "string" ? event.sessionID : undefined;
    if (sid !== undefined && this.session !== undefined && sid !== this.session) {
      this.flush();
      this.open = undefined;
    }
    this.session = sid ?? this.session;
    if (type === "step_start") {
      this.flush();
      this.call = { marks: [] };
    } else if (type === "step_finish") {
      if (this.call) this.call.usage = opencodeUsage(obj(event.part));
      this.flush();
    } else if (this.call) this.note(this.call, line);
    else this.lone(line);
  }

  codex(event: Record<string, unknown>, type: string, line: string): void {
    if (type === "thread.started") this.thread = typeof event.thread_id === "string" ? event.thread_id : "";
    else if (type === "turn.started") this.turnOpen = this.open;
    else if (type === "turn.completed") {
      const soFar = codexUsage(event.usage);
      const grew = soFar === undefined ? undefined : Math.max(soFar - (this.threadSoFar.get(this.thread) ?? 0), 0);
      if (soFar !== undefined) this.threadSoFar.set(this.thread, soFar);
      if (this.turnOpen !== undefined && this.open === this.turnOpen) this.add(grew, this.turnOpen);
      this.turnOpen = undefined;
    } else if (type === "item.completed") this.lone(line);
  }
}

export function stepTokens(text: string, tool?: SummarizeOptions["tool"]): Map<string, number> {
  const kind = transcriptFormat(tool, text);
  const counter = new StepTokenCounter(kind);
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
    if (kind === "claude") counter.claude(event, type, line);
    else if (kind === "opencode") counter.opencode(event, type, line);
    else counter.codex(event, type, line);
  }
  counter.flush();
  return counter.totals;
}
