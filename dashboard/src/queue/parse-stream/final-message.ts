// The assistant's own closing word.
import { summarizeEntries } from "./entries.ts";
import { codexKind, esc, events, sniff, type SummarizeOptions } from "./shared.ts";

/** The assistant's own final message, in full — Claude's one `result`
 *  event's `result` field, Codex's LAST `agent_message` item's text, or
 *  opencode's last `text` part. Unclipped, unlike every entry
 *  `summarizeStream` returns: this is the run's own closing word, not a
 *  one-line label for something else. */
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
    } else if (tool === "opencode") {
      const part = event.part;
      if (part === null || typeof part !== "object" || Array.isArray(part)) continue;
      const p = part as Record<string, unknown>;
      if (p.type !== "text") continue;
      if (typeof p.text === "string" && p.text.trim()) found = esc(p.text);
    } else {
      if (event.type !== "result") continue;
      if (typeof event.result === "string" && event.result.trim()) found = esc(event.result);
    }
  }
  return found;
}


/** Whether a clipped entry (one flat line, at most 160 characters) is the
 *  final message itself. Both are escaped, and escaping is per character,
 *  so the clip is a prefix. */
export function isFinal(entry: string, final: string): boolean {
  const flat = final.replace(/\s+/g, " ").trim();
  return entry === flat || (entry.endsWith("…") && flat.startsWith(entry.slice(0, -1)));
}

/** A step's log lines and its final message. The last line is left out
 *  when it only repeats the message, so the message reads once, after the
 *  lines that led to it. */
export function logAndFinalMessage(
  text: string,
  opts: SummarizeOptions = {},
): { lines: string[]; finalMessage?: string } {
  const lines = summarizeEntries(text, { ...opts, only: undefined }).map((e) => e.text);
  const final = finalMessage(text, opts);
  if (final && lines.length && isFinal(lines[lines.length - 1]!, final)) lines.pop();
  return { lines, finalMessage: final };
}
