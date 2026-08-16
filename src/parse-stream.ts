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
}

/** The transcript as a bounded list of already-escaped lines: assistant
 *  text and tool calls only. System init, tool results, thinking and
 *  rate-limit chatter are the run talking to itself, not what it is
 *  doing. */
export function summarizeStream(text: string, opts: SummarizeOptions = {}): string[] {
  const max = opts.max ?? 40;
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      event = parsed as Record<string, unknown>;
    } catch {
      continue; // a truncated or non-JSON line costs nothing
    }
    if (event.type !== "assistant") continue;
    for (const block of blocksOf(event)) {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        out.push(esc(clip(block.text)));
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        const subject = toolSubject(block.input);
        out.push(esc(clip(subject ? `${block.name} ${subject}` : block.name)));
      }
    }
    // Trimming as we go, not at the end: a long run's transcript should
    // never be held in memory in full just to throw most of it away.
    if (out.length > max * 2) out.splice(0, out.length - max);
  }
  return out.slice(-max);
}
