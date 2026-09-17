// The commands a step ran, read from its transcript.
import { clip, codexKind, esc, events, sniff, blocksOf, toolSubject, trim, type SummarizeOptions } from "./shared.ts";

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

/** opencode's shell tool, verified against 1.18.31: a `tool` part named
 *  `bash`, whose `state` carries the command it ran, the exit code under
 *  `metadata.exit`, and a start/end pair. It is the one of the three
 *  schemas that reports BOTH an exit code and a duration. */
function opencodeCommands(text: string, max: number): StepCommand[] {
  const out: StepCommand[] = [];
  for (const event of events(text)) {
    const part = event.part;
    if (part === null || typeof part !== "object" || Array.isArray(part)) continue;
    const p = part as Record<string, unknown>;
    if (p.type !== "tool" || p.tool !== "bash") continue;
    const state = p.state;
    if (state === null || typeof state !== "object" || Array.isArray(state)) continue;
    const st = state as Record<string, unknown>;
    const input = st.input as Record<string, unknown> | undefined;
    const command = typeof input?.command === "string" ? input.command : "";
    const meta = st.metadata as Record<string, unknown> | undefined;
    // Never invented, for the reason codexCommands says: a tool call
    // with no numeric exit is not this dashboard's to guess at.
    if (!command || typeof meta?.exit !== "number") continue;
    const time = st.time as Record<string, unknown> | undefined;
    const durationMs =
      typeof time?.start === "number" && typeof time?.end === "number"
        ? time.end - time.start
        : undefined;
    out.push({
      command: esc(clip(command)),
      outcome: { kind: "exitCode", code: meta.exit },
      ...(durationMs === undefined ? {} : { durationMs }),
    });
    trim(out, max);
  }
  return out.slice(-max);
}

/** The commands a step ran, whichever tool wrote the transcript — same
 *  bound as `summarizeStream`, same escaping. */
export function summarizeCommands(text: string, opts: SummarizeOptions = {}): StepCommand[] {
  const max = opts.max ?? 40;
  const tool = opts.tool ?? sniff(text);
  if (tool === "codex") return codexCommands(text, max);
  if (tool === "opencode") return opencodeCommands(text, max);
  return claudeCommands(text, max);
}
