// A transcript as the bounded list of lines a person reads: what the
// run said and what it did, one line each, in the three CLIs' own
// schemas turned into one shape.
import {
  blocksOf, CLAUDE_WRITES, clip, codexKind, esc, events, keepsEntry, sniff, toolSubject, trim,
  type StreamEntry, type StreamEntryKind, type SummarizeOptions,
} from "./shared.ts";

/** The transcript as a bounded list of already-escaped lines: assistant
 *  text and tool calls only. System init, tool results, thinking and
 *  rate-limit chatter are the run talking to itself, not what it is
 *  doing. */
export function summarizeClaudeStream(text: string, opts: SummarizeOptions = {}): string[] {
  return claudeEntries(text, opts).map((e) => e.text);
}

/** Which tool calls this transcript's own results reported as failures,
 *  by the id the call and its result share. Read in a pass of its own
 *  because a result arrives AFTER the call it answers: an entry cannot
 *  know its own outcome at the moment it is built. */
function failedToolUses(text: string): Set<string> {
  const failed = new Set<string>();
  for (const event of events(text)) {
    if (event.type !== "user") continue;
    for (const block of blocksOf(event)) {
      if (block.type === "tool_result" && block.is_error && typeof block.tool_use_id === "string") {
        failed.add(block.tool_use_id);
      }
    }
  }
  return failed;
}

function claudeEntries(text: string, opts: SummarizeOptions = {}): StreamEntry[] {
  const max = opts.max ?? 40;
  const failed = failedToolUses(text);
  const out: StreamEntry[] = [];
  const keep = (entry: StreamEntry) => {
    if (keepsEntry(entry, opts.only)) out.push(entry);
  };
  for (const event of events(text)) {
    if (event.type !== "assistant") continue;
    for (const block of blocksOf(event)) {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        keep({ kind: "text", text: esc(clip(block.text)) });
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        const subject = toolSubject(block.input);
        const kind: StreamEntryKind =
          block.name === "Bash" ? "command" : CLAUDE_WRITES.has(block.name) ? "file" : "tool";
        keep({
          kind,
          text: esc(clip(subject ? `${block.name} ${subject}` : block.name)),
          ...(typeof block.id === "string" && failed.has(block.id) ? { failed: true } : {}),
        });
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
function codexEntry(item: Record<string, unknown>): { text: string; kind: StreamEntryKind; failed?: boolean } {
  const text = codexEntryText(item);
  const kind = codexKind(item);
  const exit = item.exit_code;
  return {
    text,
    kind:
      kind === "command_execution" ? "command"
      : kind === "file_change" ? "file"
      : kind === "agent_message" ? "text"
      : "tool",
    // Codex reports the outcome on the item itself, so no second pass
    // is needed — and, as `codexCommands` says, an item with no numeric
    // exit code is not this dashboard's to guess an outcome for.
    ...(kind === "command_execution" && typeof exit === "number" && exit !== 0 ? { failed: true } : {}),
  };
}

function codexEntryText(item: Record<string, unknown>): string {
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
  return codexEntries(text, opts).map((e) => e.text);
}

function codexEntries(text: string, opts: SummarizeOptions = {}): StreamEntry[] {
  const max = opts.max ?? 40;
  const out: StreamEntry[] = [];
  for (const event of events(text)) {
    if (event.type !== "item.completed") continue;
    const item = event.item;
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const { text: said, ...rest } = codexEntry(item as Record<string, unknown>);
    const entry: StreamEntry = { ...rest, text: esc(clip(said)) };
    if (said.trim() && keepsEntry(entry, opts.only)) out.push(entry);
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
function opencodeEntry(part: Record<string, unknown>): { text: string; kind: StreamEntryKind; failed?: boolean } {
  const str = (k: string) => (typeof part[k] === "string" ? (part[k] as string) : "");
  const text = opencodeEntryText(part);
  if (str("type") !== "tool") return { text, kind: "text" };
  const tool = str("tool");
  const state = part.state;
  const meta =
    state !== null && typeof state === "object" && !Array.isArray(state)
      ? (state as Record<string, unknown>).metadata
      : undefined;
  const exit =
    meta !== null && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Record<string, unknown>).exit
      : undefined;
  return {
    text,
    // `bash` is opencode's own name for its shell tool, the same one
    // `opencodeCommands` reads; `write` and `edit` are its writers.
    kind: tool === "bash" ? "command" : tool === "write" || tool === "edit" ? "file" : "tool",
    ...(tool === "bash" && typeof exit === "number" && exit !== 0 ? { failed: true } : {}),
  };
}

function opencodeEntryText(part: Record<string, unknown>): string {
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
  return opencodeEntries(text, opts).map((e) => e.text);
}

function opencodeEntries(text: string, opts: SummarizeOptions = {}): StreamEntry[] {
  const max = opts.max ?? 40;
  const out: StreamEntry[] = [];
  for (const event of events(text)) {
    const part = event.part;
    if (part === null || typeof part !== "object" || Array.isArray(part)) continue;
    const { text: said, ...rest } = opencodeEntry(part as Record<string, unknown>);
    const entry: StreamEntry = { ...rest, text: esc(clip(said)) };
    if (said.trim() && keepsEntry(entry, opts.only)) out.push(entry);
    trim(out, max);
  }
  return out.slice(-max);
}

/** The transcript, whichever tool wrote it, as classified entries — the
 *  shape a reader asking for one kind needs. `summarizeStream` is this
 *  with the kinds dropped, which is all a caller that shows every line
 *  ever wanted. */
export function summarizeEntries(text: string, opts: SummarizeOptions = {}): StreamEntry[] {
  const tool = opts.tool ?? sniff(text);
  if (tool === "codex") return codexEntries(text, opts);
  if (tool === "opencode") return opencodeEntries(text, opts);
  return claudeEntries(text, opts);
}

/** The transcript, whichever tool wrote it. */
export function summarizeStream(text: string, opts: SummarizeOptions = {}): string[] {
  return summarizeEntries(text, opts).map((e) => e.text);
}
