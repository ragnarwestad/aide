// A Claude session's subagents, one part each. A subagent's events carry the
// id of the `Agent` call that started it in `parent_tool_use_id`; the
// session's own carry null. A call a subagent makes has its subagent's events
// in the subagent's part: an id is followed upward to the call the session
// itself made.
import { claudeBlockEntries, failedToolUses, parentCall } from "./entries.ts";
import { withoutRepeat } from "./final-message.ts";
import { blocksOf, esc, events } from "./shared.ts";
import type { SubagentPart } from "./step-log.ts";

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** The text of a tool result's `content`: a string, or the text blocks of a list. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (isObject(b) && typeof b.text === "string" ? b.text : "")).filter(Boolean).join("\n");
}

/** What a call's `tool_result` answered, never the launch message of a
 *  background call: that subagent has no answer until its notification. */
function resultText(event: Record<string, unknown>, block: unknown): string | undefined {
  const outcome = event.tool_use_result;
  if (isObject(outcome)) {
    if (outcome.status === "async_launched") return undefined;
    const given = textOf(outcome.content).trim();
    if (given) return given;
  }
  return textOf(isObject(block) ? block.content : undefined).trim() || undefined;
}

/** Every `Agent` call the session made, as a part, by the call's id. */
export function claudeSubagents(text: string): Map<string, SubagentPart> {
  const failed = failedToolUses(text);
  const parts = new Map<string, SubagentPart>();
  const parentOf = new Map<string, string | undefined>(); // every Agent call, by id: the call it was made inside, if any
  const answered = new Map<string, string>();
  const notified = new Map<string, string>();
  /** The call the session made that `id` belongs to, however deep. */
  const rootOf = (id: string): string | undefined => {
    for (let at: string | undefined = id; at !== undefined && parentOf.has(at); at = parentOf.get(at)) {
      if (parts.has(at)) return at;
    }
    return undefined;
  };
  for (const event of events(text)) {
    const parent = parentCall(event);
    if (event.type === "system" && event.subtype === "task_notification") {
      if (typeof event.tool_use_id === "string" && typeof event.summary === "string" && event.summary.trim()) {
        notified.set(event.tool_use_id, event.summary.trim());
      }
    } else if (event.type === "assistant") {
      for (const block of blocksOf(event)) {
        if (block.type !== "tool_use" || block.name !== "Agent" || typeof block.id !== "string") continue;
        parentOf.set(block.id, parent);
        if (parent !== undefined) continue;
        const input = isObject(block.input) ? block.input : {};
        const named = [input.description, input.subagent_type].find((n): n is string => typeof n === "string" && n.trim() !== "");
        parts.set(block.id, {
          by: "subagent",
          name: named ?? "agent",
          ...(typeof input.prompt === "string" && input.prompt.trim() ? { asked: esc(input.prompt.trim()) } : {}),
          lines: [],
        });
      }
      const root = parent === undefined ? undefined : rootOf(parent);
      if (root !== undefined) parts.get(root)!.lines.push(...claudeBlockEntries(event, failed, true).map((e) => e.text));
    } else if (event.type === "user" && parent === undefined) {
      for (const block of blocksOf(event)) {
        if (block.type !== "tool_result" || typeof block.tool_use_id !== "string" || !parts.has(block.tool_use_id)) continue;
        const given = resultText(event, block);
        if (given !== undefined) answered.set(block.tool_use_id, given);
      }
    }
  }
  const out = new Map<string, SubagentPart>();
  for (const [id, part] of parts) {
    const raw = notified.get(id) ?? answered.get(id);
    out.set(id, raw === undefined ? part : { ...part, lines: withoutRepeat(part.lines, raw), answer: esc(raw) });
  }
  return out;
}
