// The assistant's own closing word.
import { summarizeEntries } from "./entries.ts";
import { codexKind, esc, events, prose, sniff, splitMarks, type SummarizeOptions } from "./shared.ts";

/** The assistant's own final message, in full — Claude's one `result`
 *  event's `result` field, Codex's LAST `agent_message` item's text, or
 *  opencode's last `text` part. Unclipped, unlike every entry
 *  `summarizeStream` returns: this is the run's own closing word, not a
 *  one-line label for something else. */
export function finalMessage(text: string, opts: SummarizeOptions = {}): string | undefined {
  const raw = rawFinalMessage(text, opts);
  return raw === undefined ? undefined : esc(raw);
}

function rawFinalMessage(text: string, opts: SummarizeOptions): string | undefined {
  const tool = opts.tool ?? sniff(text);
  let found: string | undefined;
  for (const event of events(text)) {
    if (tool === "codex") {
      if (event.type !== "item.completed") continue;
      const item = event.item;
      if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
      const r = item as Record<string, unknown>;
      if (codexKind(r) !== "agent_message") continue;
      if (typeof r.text === "string" && r.text.trim()) found = r.text;
    } else if (tool === "opencode") {
      const part = event.part;
      if (part === null || typeof part !== "object" || Array.isArray(part)) continue;
      const p = part as Record<string, unknown>;
      if (p.type !== "text") continue;
      if (typeof p.text === "string" && p.text.trim()) found = p.text;
    } else {
      if (event.type !== "result") continue;
      if (typeof event.result === "string" && event.result.trim()) found = event.result;
    }
  }
  return found;
}

/** Lines ending on the final message in full. The entries the message
 *  itself made — its prose clipped, each step mark on its own — are
 *  replaced when the lines end on them, and the message is appended when
 *  they do not; its prose is unclipped, its marks stay lines of their own.
 *  `cut` bounds a prose piece for a reader that shows less. */
export function endWithFinalMessage(
  lines: string[],
  text: string,
  opts: SummarizeOptions = {},
  cut: (escaped: string) => string = (t) => t,
): string[] {
  const raw = rawFinalMessage(text, opts);
  if (raw === undefined) return lines;
  const pieces = splitMarks(raw);
  const clipped = pieces.map((p) => esc(prose(p.text, !!opts.whole && !p.mark)));
  const full = pieces.map((p) => (p.mark ? esc(p.text) : cut(esc(p.text.trim()))));
  const n = clipped.length;
  const endsOnIt = n > 0 && n <= lines.length && clipped.every((c, i) => lines[lines.length - n + i] === c);
  return [...(endsOnIt ? lines.slice(0, lines.length - n) : lines), ...full];
}

/** A step's log lines, the last of them the whole final message. */
export function linesWithFinalMessage(text: string, opts: SummarizeOptions = {}): string[] {
  return endWithFinalMessage(summarizeEntries(text, { ...opts, only: undefined }).map((e) => e.text), text, opts);
}
