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

/** How many of the last of `lines` are the entries `raw` itself made — its
 *  prose clipped, each step mark on its own — and so are said again by `raw`
 *  in full. */
function repeatedTail(lines: string[], raw: string, whole: boolean): number {
  const clipped = splitMarks(raw).map((p) => esc(prose(p.text, whole && !p.mark)));
  const n = clipped.length;
  return n > 0 && n <= lines.length && clipped.every((c, i) => lines[lines.length - n + i] === c) ? n : 0;
}

/** `lines` without the last of them that only repeat `raw`, the whole text
 *  a subagent answered with, which its part shows once, as its answer. */
export function withoutRepeat(lines: string[], raw: string): string[] {
  return lines.slice(0, lines.length - repeatedTail(lines, raw, true));
}

/** How a step's lines end on its final message: the first `kept` of them
 *  stay, and `added` follows — the message in full, its marks lines of their
 *  own. Undefined when the transcript has no final message. */
export function finalTail(
  lines: string[],
  text: string,
  opts: SummarizeOptions = {},
  cut: (escaped: string) => string = (t) => t,
): { kept: number; added: string[] } | undefined {
  const raw = rawFinalMessage(text, opts);
  if (raw === undefined) return undefined;
  const added = splitMarks(raw).map((p) => (p.mark ? esc(p.text) : cut(esc(p.text.trim()))));
  return { kept: lines.length - repeatedTail(lines, raw, !!opts.whole), added };
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
  const tail = finalTail(lines, text, opts, cut);
  return tail ? [...lines.slice(0, tail.kept), ...tail.added] : lines;
}

/** A step's log lines, the last of them the whole final message. */
export function linesWithFinalMessage(text: string, opts: SummarizeOptions = {}): string[] {
  return endWithFinalMessage(summarizeEntries(text, { ...opts, only: undefined }).map((e) => e.text), text, opts);
}
