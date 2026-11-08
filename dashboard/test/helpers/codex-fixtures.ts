// A Codex step as the tests build it: the `codex exec --json` stream the
// dashboard keeps, and the session files Codex keeps under CODEX_HOME, in
// the shapes measured on codex-cli 0.160.0. Each builder returns the event
// as an object; `lines` joins events into the text of a file.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Thread ids are UUID-shaped, as Codex writes them. T is the step's own thread, S its subagent's. */
export const T = "01a10bd3-c438-7812-a7ec-3ac2870b8939";
export const S = "01a10bd7-b38f-7960-9137-56dff65df0f8";
export const S2 = "01a10bd7-d3c4-7122-a320-367e15e0b3c4";

export const lines = (events: unknown[]): string => events.map((e) => JSON.stringify(e)).join("\n") + "\n";

// The stream (`codex exec --json`).
export const started = (thread: string) => ({ type: "thread.started", thread_id: thread });
export const said = (text: string) => ({ type: "item.completed", item: { id: "item_1", type: "agent_message", text } });
export const ran = (command: string, exit = 0) => ({
  type: "item.completed",
  item: { id: "item_2", type: "command_execution", command, aggregated_output: "", exit_code: exit, status: "completed" },
});

// A session file (`~/.codex/sessions/…/rollout-…-<thread>.jsonl`).
const event = (payload: Record<string, unknown>) => ({ timestamp: "2026-10-05T11:30:00.000Z", type: "event_msg", payload });
const item = (it: Record<string, unknown>) => event({ type: "item_completed", item: it });
export const sAgent = (text: string) => item({ type: "AgentMessage", content: [{ type: "Text", text }], phase: "commentary" });
export const sRan = (...argv: string[]) => item({ type: "CommandExecution", command: argv, exit_code: 0, status: "completed" });
export const sEdit = (...paths: string[]) =>
  item({ type: "FileChange", changes: Object.fromEntries(paths.map((p) => [p, { type: "update", unified_diff: "@@" }])) });
export const sSpawn = (thread: string, path: string, kind = "started") =>
  item({ type: "SubAgentActivity", id: "call_1", kind, agent_thread_id: thread, agent_path: path });
export const sDone = (last: string | null) => event({ type: "task_complete", last_agent_message: last });

/** Where Codex keeps a thread's session file under its home. */
export const sessionPath = (thread: string, at = "2026-10-05T13-29-50") => join("sessions", "2026", "10", "05", `rollout-${at}-${thread}.jsonl`);

/** Writes session files into `home`, one per thread. */
export function writeSessions(home: string, files: Record<string, unknown[]>): void {
  for (const [thread, events] of Object.entries(files)) {
    const path = join(home, sessionPath(thread));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, lines(events));
  }
}

/** The step's thread T starting a subagent S named `feasibility` after two items, and S's own work. */
export const feasibility = {
  parent: [sAgent("m1"), sRan("/bin/zsh", "-lc", "c1"), sSpawn(S, "/root/feasibility"), sAgent("m2")],
  child: [sRan("/bin/zsh", "-lc", "cat plan.md"), sAgent("looks fine")],
};
