// A kept `claude --output-format stream-json` transcript, turned into
// something a person can read at a glance (spec 02).
//
// Three properties, and none of them is negotiable:
//
//   * BOUNDED. A 25-minute implement run writes tens of thousands of
//     events; the page shows the tail, because "what is it doing" is a
//     question about now. Each entry is bounded too — a Write's input is
//     a whole file.
//   * ESCAPED HERE, not at the call site. Every string in a transcript
//     is arbitrary text a model wrote or a tool was handed. Escaping in
//     the parser means no renderer can forget to.
//   * NEVER THROWS. The file is written by another process and read
//     while it is still being written, so a truncated final line is the
//     normal case, not the exception.

/** Longest single entry. Past this a tool input is a file, not a label. */
const MAX_ENTRY = 160;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clip(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > MAX_ENTRY ? `${flat.slice(0, MAX_ENTRY)}…` : flat;
}

// What a tool call was actually about. `file_path` for a Read, `command`
// for a Bash, `pattern` for a Grep — the first of these that is there,
// because a bare tool name says nothing a reader did not already know.
const SUBJECT_KEYS = ["file_path", "command", "pattern", "path", "prompt", "description", "query", "content"];

function toolSubject(input: unknown): string {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return "";
  const r = input as Record<string, unknown>;
  for (const key of SUBJECT_KEYS) {
    if (typeof r[key] === "string" && r[key]) return r[key] as string;
  }
  return "";
}

interface StreamBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  id?: string;
  tool_use_id?: string;
  is_error?: boolean;
}

function blocksOf(event: Record<string, unknown>): StreamBlock[] {
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
}

/** Every line of the stream that parses, as an object. Shared by both
 *  parsers, because "never throws" is a property of the reader and not
 *  of either schema: the file is written by another process and read
 *  while it is still being written. */
function* events(text: string): Generator<Record<string, unknown>> {
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
 *  by the activity list (`string[]`) and the command list (`StepCommand[]`,
 *  spec 452) — the bound is a property of the reader, not of the shape. */
function trim<T>(out: T[], max: number): void {
  if (out.length > max * 2) out.splice(0, out.length - max);
}

/** The transcript as a bounded list of already-escaped lines: assistant
 *  text and tool calls only. System init, tool results, thinking and
 *  rate-limit chatter are the run talking to itself, not what it is
 *  doing. */
export function summarizeClaudeStream(text: string, opts: SummarizeOptions = {}): string[] {
  const max = opts.max ?? 40;
  const out: string[] = [];
  for (const event of events(text)) {
    if (event.type !== "assistant") continue;
    for (const block of blocksOf(event)) {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        out.push(esc(clip(block.text)));
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        const subject = toolSubject(block.input);
        out.push(esc(clip(subject ? `${block.name} ${subject}` : block.name)));
      }
    }
    trim(out, max);
  }
  return out.slice(-max);
}

/** What a Codex item was about, in the same one-line shape a Claude tool
 *  call gets. The item types are `codex exec --json`'s own
 *  (`agent_message`, `command_execution`, `file_change`, `mcp_tool_call`,
 *  `web_search`), verified against codex-cli 0.147.0.
 *
 *  `reasoning` is deliberately absent: it is the run talking to itself,
 *  exactly like a Claude `thinking` block, and neither belongs on a page
 *  answering "what is it doing". */
function codexEntry(item: Record<string, unknown>): string {
  const str = (k: string) => (typeof item[k] === "string" ? (item[k] as string) : "");
  // Both names for the same field. codex-cli 0.148.0 sends `type`
  // (measured from a real turn, 2026-08-20); `item_type` also appears
  // in the binary's strings and is what spec 125 read. Which one a
  // version sends is the CLI's to change, so neither is dropped.
  const kind = str("item_type") || str("type");
  switch (kind) {
    case "agent_message":
      return str("text");
    case "command_execution":
      return str("command");
    case "file_change": {
      const changes = Array.isArray(item.changes) ? (item.changes as Record<string, unknown>[]) : [];
      const paths = changes.map((c) => (typeof c?.path === "string" ? c.path : "")).filter(Boolean);
      return paths.length ? `edit ${paths.join(", ")}` : "";
    }
    case "mcp_tool_call": {
      const named = [str("server"), str("tool") || str("tool_name")].filter(Boolean).join(" ");
      return named || "";
    }
    case "web_search":
      return str("query") ? `search ${str("query")}` : "";
    default:
      return "";
  }
}

/** The Codex half of the same contract: same entry shape, same bound,
 *  same escaping. Only `item.completed` is read — `item.started` carries
 *  the same item a moment earlier, and counting both would say
 *  everything twice. */
export function summarizeCodexStream(text: string, opts: SummarizeOptions = {}): string[] {
  const max = opts.max ?? 40;
  const out: string[] = [];
  for (const event of events(text)) {
    if (event.type !== "item.completed") continue;
    const item = event.item;
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = codexEntry(item as Record<string, unknown>);
    if (entry.trim()) out.push(esc(clip(entry)));
    trim(out, max);
  }
  return out.slice(-max);
}

/** What an opencode event was about, in the same one-line shape the
 *  other two get. Its events carry the interesting part under `part`,
 *  keyed by `part.type`, verified against opencode 1.18.31.
 *
 *  `step-start` and `step-finish` are absent on purpose: they are the
 *  run's own bookkeeping, and a page answering "what is it doing" wants
 *  neither. */
function opencodeEntry(part: Record<string, unknown>): string {
  const str = (k: string) => (typeof part[k] === "string" ? (part[k] as string) : "");
  switch (str("type")) {
    case "text":
      return str("text");
    case "tool": {
      // The tool's own name is the whole of what there is to say: the
      // input is a free-form object whose shape is the tool's, and
      // guessing which key holds a path would be wrong per tool.
      const name = str("tool");
      return name ? `tool ${name}` : "";
    }
    default:
      return "";
  }
}

/** The opencode half of the same contract: same entry shape, same
 *  bound, same escaping. */
export function summarizeOpencodeStream(text: string, opts: SummarizeOptions = {}): string[] {
  const max = opts.max ?? 40;
  const out: string[] = [];
  for (const event of events(text)) {
    const part = event.part;
    if (part === null || typeof part !== "object" || Array.isArray(part)) continue;
    const entry = opencodeEntry(part as Record<string, unknown>);
    if (entry.trim()) out.push(esc(clip(entry)));
    trim(out, max);
  }
  return out.slice(-max);
}

/** Which schema this text is in, when nobody said. Codex's events are
 *  the only ones whose `type` is dotted, and opencode's are the only
 *  ones carrying a `part` object, so one parsable line settles it; a
 *  file that says none of them falls to claude, which is what every
 *  transcript written before there was a second tool is. */
function sniff(text: string): "claude" | "codex" | "opencode" {
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

/** The transcript, whichever tool wrote it. */
export function summarizeStream(text: string, opts: SummarizeOptions = {}): string[] {
  const tool = opts.tool ?? sniff(text);
  if (tool === "codex") return summarizeCodexStream(text, opts);
  if (tool === "opencode") return summarizeOpencodeStream(text, opts);
  return summarizeClaudeStream(text, opts);
}

// --- spec 452: the Logs tab's summary --------------------------------------
//
// Two things the bounded activity list above deliberately drops: which
// commands a step ran, and the assistant's own final message in full.
// Neither tool's transcript alone carries BOTH a real exit code and a
// duration for every command (2-analysis.md's stream-format
// investigation) — Claude's Bash result never carries a numeric exit
// code, only `is_error`, while Codex's `command_execution` item carries
// a real `exit_code` but no event in that schema carries a timestamp at
// all. So the two are read differently, and neither invents what its
// own tool's schema does not report.

export interface StepCommand {
  command: string;
  outcome: { kind: "exitCode"; code: number } | { kind: "ok" | "failed" };
  /** Absent for Codex — no event in that schema carries a timestamp. */
  durationMs?: number;
}

/** Which item kind a Codex event names itself — `codexEntry`'s own
 *  lookup (see its comment), read again here because the item shapes
 *  this reads are different ones (`command_execution`, `agent_message`),
 *  not because the rule differs. */
function codexKind(item: Record<string, unknown>): string {
  const str = (k: string) => (typeof item[k] === "string" ? (item[k] as string) : "");
  return str("item_type") || str("type");
}

function claudeCommands(text: string, max: number): StepCommand[] {
  const open = new Map<string, { command: string; at?: string }>();
  const out: StepCommand[] = [];
  for (const event of events(text)) {
    const at = typeof event.timestamp === "string" ? event.timestamp : undefined;
    if (event.type === "assistant") {
      for (const block of blocksOf(event)) {
        if (block.type === "tool_use" && block.name === "Bash" && typeof block.id === "string") {
          const command = toolSubject(block.input);
          if (command) open.set(block.id, { command, at });
        }
      }
    } else if (event.type === "user") {
      for (const block of blocksOf(event)) {
        if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
        const pending = open.get(block.tool_use_id);
        if (!pending) continue;
        open.delete(block.tool_use_id);
        const durationMs = pending.at && at ? Date.parse(at) - Date.parse(pending.at) : NaN;
        out.push({
          command: esc(clip(pending.command)),
          outcome: block.is_error ? { kind: "failed" } : { kind: "ok" },
          ...(Number.isFinite(durationMs) ? { durationMs } : {}),
        });
        trim(out, max);
      }
    }
  }
  return out.slice(-max);
}

function codexCommands(text: string, max: number): StepCommand[] {
  const out: StepCommand[] = [];
  for (const event of events(text)) {
    if (event.type !== "item.completed") continue;
    const item = event.item;
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    if (codexKind(r) !== "command_execution") continue;
    const command = typeof r.command === "string" ? r.command : "";
    // Never invented: a completed command item with no numeric exit
    // code is not this dashboard's to guess an outcome for.
    if (!command || typeof r.exit_code !== "number") continue;
    out.push({ command: esc(clip(command)), outcome: { kind: "exitCode", code: r.exit_code } });
    trim(out, max);
  }
  return out.slice(-max);
}

/** The commands a step ran, whichever tool wrote the transcript — same
 *  bound as `summarizeStream`, same escaping. */
export function summarizeCommands(text: string, opts: SummarizeOptions = {}): StepCommand[] {
  const max = opts.max ?? 40;
  const tool = opts.tool ?? sniff(text);
  return tool === "codex" ? codexCommands(text, max) : claudeCommands(text, max);
}

/** The assistant's own final message, in full — Claude's one `result`
 *  event's `result` field, or Codex's LAST `agent_message` item's text.
 *  Unclipped, unlike every entry `summarizeStream` returns: this is the
 *  run's own closing word, not a one-line label for something else. */
export function finalMessage(text: string, opts: SummarizeOptions = {}): string | undefined {
  const tool = opts.tool ?? sniff(text);
  let found: string | undefined;
  for (const event of events(text)) {
    if (tool === "codex") {
      if (event.type !== "item.completed") continue;
      const item = event.item;
      if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
      const r = item as Record<string, unknown>;
      if (codexKind(r) !== "agent_message") continue;
      if (typeof r.text === "string" && r.text.trim()) found = esc(r.text);
    } else {
      if (event.type !== "result") continue;
      if (typeof event.result === "string" && event.result.trim()) found = esc(event.result);
    }
  }
  return found;
}
