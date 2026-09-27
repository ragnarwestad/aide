// The primitives every reader of a kept transcript shares.
//
// Three properties, and none of them is negotiable:
//
//   * BOUNDED where the reader asks for it. A 25-minute implement run
//     writes tens of thousands of events; a phase's row shows the tail,
//     because "what is it doing" is a question about now, while the Logs
//     page asks for every line. No bound drops a skill-step mark. Each
//     entry is bounded too — a Write's input is a whole file.
//   * ESCAPED HERE, not at the call site. Every string in a transcript
//     is arbitrary text a model wrote or a tool was handed. Escaping in
//     the parser means no renderer can forget to.
//   * NEVER THROWS. The file is written by another process and read
//     while it is still being written, so a truncated final line is the
//     normal case, not the exception.

/** Longest single entry. Past this a tool input is a file, not a label. */
const MAX_ENTRY = 160;

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A shell command as one line that still shows where its lines broke:
 *  `cd x ⏎ sed …`, not `cd x sed …`. A line ending in `\` continues onto
 *  the next, so that break is a plain space. */
export function commandLine(s: string): string {
  return s
    .trim()
    .replace(/\\\n\s*/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ⏎ ");
}

export function clip(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > MAX_ENTRY ? `${flat.slice(0, MAX_ENTRY)}…` : flat;
}

// What a tool call was actually about. `file_path` for a Read, `command`
// for a Bash, `pattern` for a Grep — the first of these that is there,
// because a bare tool name says nothing a reader did not already know.
const SUBJECT_KEYS = ["file_path", "command", "pattern", "path", "prompt", "description", "query", "content"];

export function toolSubject(input: unknown): string {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return "";
  const r = input as Record<string, unknown>;
  for (const key of SUBJECT_KEYS) {
    if (typeof r[key] === "string" && r[key]) return r[key] as string;
  }
  return "";
}

export interface StreamBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  id?: string;
  tool_use_id?: string;
  is_error?: boolean;
}

export function blocksOf(event: Record<string, unknown>): StreamBlock[] {
  const message = event.message;
  if (message === null || typeof message !== "object" || Array.isArray(message)) return [];
  const content = (message as Record<string, unknown>).content;
  return Array.isArray(content) ? (content as StreamBlock[]) : [];
}

export interface SummarizeOptions {
  /** How many entries to keep, counted from the END of the stream. */
  max?: number;
  /** Which CLI wrote this transcript (spec 125). Omit it and the schema
   *  is recognised from the stream itself — `/live` tails a file whose
   *  job may predate the field entirely, and an unrecognised schema
   *  renders as an empty activity list, which reads as "it is doing
   *  nothing". */
  //
  // `fake-claude` writes Claude Code's own event shape, so it is read
  // with the same parser and named here only so a caller can pass the
  // job's tool through without narrowing it first. `none` (spec 433) is
  // a no-AI create's own value — it never actually reaches this parser,
  // since a step that ran no AI writes no transcript to summarize, but
  // the caller's own `tool` reads off the same widened field and has to
  // type-check regardless.
  tool?: "claude" | "codex" | "opencode" | "fake-claude" | "none";
  /** The model's own text in full, as it wrote it, rather than one
   *  clipped line per block: what the Logs page shows. */
  whole?: boolean;
  /** Keep only the entries a reader asked for, BEFORE the bound above
   *  is applied: "the last 40 failed commands", not "the failed
   *  commands among the last 40 entries". A step whose tail is all prose
   *  would otherwise answer "no errors" for a step that hit twenty. */
  only?: LogFilter;
}
/** What a transcript entry IS, kept rather than flattened into its text
 *  so a reader can ask for one kind. The
 *  three CLIs name these differently — a Claude `tool_use` block named
 *  `Bash`, a Codex `command_execution` item, an opencode `tool` part
 *  named `bash` are one thing — and this is where they become one word.
 *
 *  `failed` rides beside the kind rather than being a kind of its own:
 *  a command that failed is still a command. */
export type StreamEntryKind = "text" | "tool" | "command" | "file";

export interface StreamEntry {
  kind: StreamEntryKind;
  /** Already escaped and clipped, exactly as `summarizeStream` returns. */
  text: string;
  /** Whether the tool reported this entry's own failure. Only a command
   *  can carry it: it is the one entry kind all three schemas report an
   *  outcome for. */
  failed?: boolean;
  /** A skill-step mark: kept by every bound. */
  mark?: true;
}

/** What a reader can ask of a transcript's entries: all of them, the
 *  ones the tool itself reported as failed (`errors`, the Errors tab), or
 *  only what the model wrote (`messages`). */
export type LogFilter = "all" | "errors" | "messages";

export function keepsEntry(entry: StreamEntry, only: LogFilter | undefined): boolean {
  if (!only || only === "all") return true;
  if (only === "messages") return entry.kind === "text";
  return entry.failed === true;
}

/** The tool names that WRITE, as Claude Code spells them. A tool this
 *  does not name is an ordinary tool call: guessing from the name would
 *  put an MCP server's own write in the wrong list either way. */
export const CLAUDE_WRITES = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Every line of the stream that parses, as an object. Shared by both
 *  parsers, because "never throws" is a property of the reader and not
 *  of either schema: the file is written by another process and read
 *  while it is still being written. */
export function* events(text: string): Generator<Record<string, unknown>> {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      yield parsed as Record<string, unknown>;
    } catch {
      // a truncated or non-JSON line costs nothing
    }
  }
}

/** Trimming as we go, not at the end: a long run's transcript should
 *  never be held in memory in full just to throw most of it away. Shared
 *  by the readers of a transcript — the bound is a property of the reader,
 *  not of the shape. */
export function trim(out: StreamEntry[], max: number): void {
  if (out.length > max * 2) out.splice(0, out.length, ...bounded(out, max));
}

/** The last `max` entries, and every skill-step mark before them: a mark
 *  is how a reader sees how far the run got, so no bound drops one. */
export function bounded(out: StreamEntry[], max: number): StreamEntry[] {
  let drop = out.filter((e) => !e.mark).length - max;
  return out.filter((e) => e.mark || drop-- <= 0);
}

/** A skill-step mark, as `step_log_note` in
 *  core/scripts/lib/run-spec-invocation.sh asks the model to write it:
 *  `<command> · Step N of X: <title> — started|done|skipped: …|stopped: …`.
 *  The ending is read loosely — "done (nothing to keep)" is still a mark. */
const STEP_MARK = /^[a-z][\w-]* · Step \d+ of \d+: .+ — (?:started|done|skipped|stopped)\b/;

/** A block of model text as the pieces a reader sees: each step mark on
 *  its own, the prose between marks kept together. Unescaped and
 *  unclipped; the caller does both. */
export function splitMarks(text: string): { text: string; mark?: true }[] {
  const out: { text: string; mark?: true }[] = [];
  let prose: string[] = [];
  const flush = () => {
    if (prose.join("").trim()) out.push({ text: prose.join("\n") });
    prose = [];
  };
  for (const line of text.split("\n")) {
    const bare = line.trim().replace(/^[`*]+|[`*]+$/g, "");
    if (STEP_MARK.test(bare)) {
      flush();
      out.push({ text: bare, mark: true });
    } else prose.push(line);
  }
  flush();
  return out;
}

/** A block of model text as escaped entries: clipped to one line each,
 *  or `whole` — each piece of prose as the model wrote it, line breaks
 *  and all. */
export function textEntries(text: string, whole = false): StreamEntry[] {
  return splitMarks(text).map((p) => ({ kind: "text", text: esc(prose(p.text, whole && !p.mark)), ...(p.mark ? { mark: true } : {}) }));
}

/** A piece of model text as a Log shows it: whole, or clipped. */
export function prose(text: string, whole: boolean): string {
  return whole ? text.trim() : clip(text);
}
/** Which schema this text is in, when nobody said. Codex's events are
 *  the only ones whose `type` is dotted, and opencode's are the only
 *  ones carrying a `part` object, so one parsable line settles it; a
 *  file that says none of them falls to claude, which is what every
 *  transcript written before there was a second tool is. */
export function sniff(text: string): "claude" | "codex" | "opencode" {
  for (const event of events(text)) {
    if (typeof event.type !== "string") continue;
    if (/^(thread|turn|item)\./.test(event.type)) return "codex";
    if (event.part !== null && typeof event.part === "object" && !Array.isArray(event.part)) {
      return "opencode";
    }
    if (event.type === "assistant" || event.type === "system" || event.type === "result") return "claude";
  }
  return "claude";
}
/** Which item kind a Codex event names itself — `codexEntry`'s own
 *  lookup (see its comment), read again here because the item shapes
 *  this reads are different ones (`command_execution`, `agent_message`),
 *  not because the rule differs. */
export function codexKind(item: Record<string, unknown>): string {
  const str = (k: string) => (typeof item[k] === "string" ? (item[k] as string) : "");
  return str("item_type") || str("type");
}
