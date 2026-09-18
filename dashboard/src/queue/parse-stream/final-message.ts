// The assistant's own closing word.
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

