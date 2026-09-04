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
  // job's tool through without narrowing it first.
  tool?: "claude" | "codex" | "fake-claude";
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
 *  never be held in memory in full just to throw most of it away. */
function trim(out: string[], max: number): void {
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

/** Which schema this text is in, when nobody said. Codex's events are
 *  the only ones whose `type` is dotted, so one parsable line settles
 *  it; a file that says neither falls to claude, which is what every
 *  transcript written before spec 125 is. */
function sniff(text: string): "claude" | "codex" {
  for (const event of events(text)) {
    if (typeof event.type !== "string") continue;
    if (/^(thread|turn|item)\./.test(event.type)) return "codex";
    if (event.type === "assistant" || event.type === "system" || event.type === "result") return "claude";
  }
  return "claude";
}

/** The transcript, whichever tool wrote it. */
export function summarizeStream(text: string, opts: SummarizeOptions = {}): string[] {
  const tool = opts.tool ?? sniff(text);
  return tool === "codex" ? summarizeCodexStream(text, opts) : summarizeClaudeStream(text, opts);
}
