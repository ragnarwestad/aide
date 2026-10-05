// A Codex session's subagents. The step's `codex exec --json` stream has no
// line for the call that starts one, so the call is found in the thread's own
// session file (`SubAgentActivity`, kind `started`), and the subagent's work
// in its own file. Shapes checked against codex-cli 0.160.0's session files:
// an `event_msg` line holds an `item_completed` or a `task_complete` payload.
import { commandLine, clip, esc, textEntries, type StreamEntry } from "./shared.ts";
import { withoutRepeat } from "./final-message.ts";
import type { SubagentPart } from "./step-log.ts";

/** The item kinds both the stream and a session file show, item for item. */
const NUMBERED = new Set(["AgentMessage", "CommandExecution", "FileChange"]);

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** A subagent a thread started, and where in the thread's items it was started. */
export interface Spawn {
  /** The thread whose file it was found in. */
  owner: string;
  /** The subagent's own thread, whose file holds its work. */
  thread: string;
  /** Its task name: the last segment of its path. */
  name: string;
  /** How many numbered items the owner had completed before it. */
  n: number;
}

/** The session file's payloads, in order. A line that holds neither marker
 *  is not parsed: a file is large, and most of it is neither. */
function* payloads(text: string): Generator<Record<string, unknown>> {
  for (const line of text.split("\n")) {
    if (!line.includes("item_completed") && !line.includes("task_complete")) continue;
    try {
      const event = JSON.parse(line) as unknown;
      if (isObject(event) && isObject(event.payload)) yield event.payload;
    } catch {
      // a truncated line costs nothing
    }
  }
}

export function spawnName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "agent";
}

/** The subagents a thread's session file says it started, in order. */
export function codexSpawns(sessionText: string, owner: string): Spawn[] {
  const out: Spawn[] = [];
  let n = 0;
  for (const payload of payloads(sessionText)) {
    const item = payload.item;
    if (payload.type !== "item_completed" || !isObject(item) || typeof item.type !== "string") continue;
    if (NUMBERED.has(item.type)) n++;
    else if (item.type === "SubAgentActivity" && item.kind === "started" && typeof item.agent_thread_id === "string") {
      if (out.some((s) => s.thread === item.agent_thread_id)) continue;
      out.push({ owner, thread: item.agent_thread_id, name: spawnName(typeof item.agent_path === "string" ? item.agent_path : ""), n });
    }
  }
  return out;
}

/** The line a spawn makes among its thread's own, which the stream lacks. */
export const spawnLine = (spawn: Spawn): string => esc(clip(`spawn_agent ${spawn.name}`));

function itemEntries(item: Record<string, unknown>): StreamEntry[] {
  if (item.type === "AgentMessage") {
    const parts = Array.isArray(item.content) ? item.content : [];
    const said = parts.map((c) => (isObject(c) && typeof c.text === "string" ? c.text : "")).join("\n");
    return said.trim() ? textEntries(said, true) : [];
  }
  const line = (text: string, kind: StreamEntry["kind"]): StreamEntry[] => (text.trim() ? [{ kind, text: esc(clip(text)) }] : []);
  if (item.type === "CommandExecution") {
    const command = Array.isArray(item.command) ? item.command.join(" ") : typeof item.command === "string" ? item.command : "";
    const exit = item.exit_code;
    return line(commandLine(command), "command").map((e) => (typeof exit === "number" && exit !== 0 ? { ...e, failed: true } : e));
  }
  if (item.type === "FileChange") {
    const changes = item.changes;
    const paths = isObject(changes) ? Object.keys(changes) : Array.isArray(changes) ? changes.map((c) => (isObject(c) && typeof c.path === "string" ? c.path : "")).filter(Boolean) : [];
    return paths.length ? line(`edit ${paths.join(", ")}`, "file") : [];
  }
  return [];
}

/** A spawn's own work, read from its session file: what it said and ran, and
 *  what its last `task_complete` answered. Codex keeps the task's own words
 *  encrypted, so nothing says what it was asked. A file that is missing, or
 *  in which nothing parses, gives a part that says it could not be read. */
export function codexSubagent(spawn: Spawn, sessionText: string | undefined): SubagentPart {
  const unread: SubagentPart = { by: "subagent", name: spawn.name, lines: [], unread: { thread: spawn.thread } };
  if (sessionText === undefined || !sessionText.trim()) return unread;
  let lines: string[] = [];
  let answer: string | undefined;
  let parsed = false;
  for (const payload of payloads(sessionText)) {
    parsed = true;
    if (payload.type === "task_complete") {
      answer = typeof payload.last_agent_message === "string" && payload.last_agent_message.trim() ? payload.last_agent_message.trim() : answer;
    } else if (payload.type === "item_completed" && isObject(payload.item)) {
      lines.push(...itemEntries(payload.item).map((e) => e.text));
    }
  }
  if (!parsed && !sessionText.split("\n").some((l) => l.trim() && isJson(l))) return unread;
  if (answer !== undefined) lines = withoutRepeat(lines, answer);
  return { by: "subagent", name: spawn.name, lines, ...(answer !== undefined ? { answer: esc(answer) } : {}) };
}

function isJson(line: string): boolean {
  try {
    return isObject(JSON.parse(line));
  } catch {
    return false;
  }
}
