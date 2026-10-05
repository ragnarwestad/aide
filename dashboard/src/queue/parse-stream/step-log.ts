// A step's Log: the run log (what `aide-run-spec` did) and the transcript
// (what the AI did) merged into parts, in the order things happened.
//
// The run log's grammar, and nothing else about the file:
//   aide-run-spec HH:MM:SS +Ns <text>                                     something the run did
//   aide-run-spec HH:MM:SS +Ns error: <text>                              a failure
//   aide-run-spec HH:MM:SS +Ns model turn started (transcript at byte N)  where the AI's next turn begins
//   aide-run-spec: <text>                                                 an older, unstamped note
//   <anything else>                                                       another script's line on stderr
import { aiParts, type AiTurn, type BuiltPart, type Owned } from "./ai-turn.ts";
import { claudeSubagents } from "./claude-subagents.ts";
import { codexSpawns } from "./codex-subagents.ts";
import { codexNumbering } from "./numbering.ts";
import { esc, sniff, type ItemNumbering, type SummarizeOptions } from "./shared.ts";

export type LogPart = TextPart | SubagentPart;

export interface TextPart {
  /** aide-before: before the AI's first turn. ai: one turn of the AI. aide-after: after a turn
   *  (tests, commit). aide: a finished step that ran no model turn at all. */
  by: "aide-before" | "ai" | "aide-after" | "aide";
  lines: string[]; // already escaped
}

/** A subagent's work, under the call that started it. */
export interface SubagentPart {
  by: "subagent";
  /** Claude's `description` (else its `subagent_type`), Codex's task name.
   *  Not escaped: it is shown only inside a catalogue sentence, which the
   *  renderer escapes whole. */
  name: string;
  /** What it was asked, whole and escaped. Absent for Codex, which keeps it encrypted. */
  asked?: string;
  lines: string[]; // its own work, already escaped
  /** What it answered, whole and escaped. Absent while it has not answered. */
  answer?: string;
  /** Codex: its session file was not found or not readable. Not escaped, like `name`. */
  unread?: { thread: string };
}

type RunLine = { turn: true; offset?: number } | { turn?: false; text: string; error: boolean };

const STAMPED = /^aide-run-spec (\d\d:\d\d:\d\d) \+(\d+)s (.*)$/;
const TURN = /^model turn started(?: \(transcript at byte (\d+)\))?$/;

function parseRunLog(runLog: string): RunLine[] {
  const out: RunLine[] = [];
  for (const raw of runLog.split("\n")) {
    if (!raw.trim()) continue;
    const stamped = STAMPED.exec(raw);
    if (!stamped) {
      out.push({ text: esc(raw.replace(/^aide-run-spec: /, "")), error: false });
      continue;
    }
    const [, clock, seconds, body] = stamped as unknown as [string, string, string, string];
    const turn = TURN.exec(body);
    if (turn) out.push({ turn: true, offset: turn[1] === undefined ? undefined : Number(turn[1]) });
    else out.push({ text: esc(`${clock} +${seconds}s ${body}`), error: body.startsWith("error: ") });
  }
  return out;
}

export function stepLog(
  transcript: { text: string; start: number },
  runLog: string | undefined,
  o: {
    tool?: SummarizeOptions["tool"];
    final: boolean;
    /** A Codex session file's text by thread id: the step's own thread's says where its subagents were started. */
    codexSession?: (thread: string) => string | undefined;
  },
): { logs: LogPart[]; errors: string[] } {
  const opts = { tool: o.tool, max: Infinity, whole: true }; // the Log is the whole step, every line of it in full
  const tool = o.tool ?? sniff(transcript.text);
  const aideParts: (BuiltPart | AiTurn)[] = [];
  const aide = (by: TextPart["by"], lines: RunLine[]) => {
    const own = lines.filter((l): l is Extract<RunLine, { text: string }> => !l.turn);
    if (own.length) aideParts.push({ part: { by, lines: own.map((l) => l.text) }, errors: own.filter((l) => l.error).map((l) => l.text) });
  };
  const codex = tool === "codex";
  const turns: AiTurn[] = [];
  const ai = (text: string, last: boolean, before?: ItemNumbering) => {
    const turn: AiTurn = { text, last, ...(codex ? { before, after: codexNumbering(text, before) } : {}) };
    turns.push(turn);
    aideParts.push(turn);
  };

  const entries = runLog ? parseRunLog(runLog) : [];
  const turnAt = entries.flatMap((e, i) => (e.turn ? [i] : []));
  if (turnAt.length === 0) {
    aide(o.final ? "aide" : "aide-before", entries);
    ai(transcript.text, true);
  } else if (turnAt.some((i) => (entries[i] as { offset?: number }).offset === undefined)) {
    // A log from an older script: no offsets, so the transcript cannot be cut.
    aide("aide-before", entries.slice(0, turnAt[0]));
    ai(transcript.text, true);
    aide("aide-after", entries.slice(turnAt[0]));
  } else {
    aide("aide-before", entries.slice(0, turnAt[0]));
    const bytes = Buffer.from(transcript.text);
    turnAt.forEach((at, n) => {
      const begin = (entries[at] as { offset: number }).offset;
      const next = turnAt[n + 1];
      const end = next === undefined ? Infinity : (entries[next] as { offset: number }).offset;
      const from = Math.max(begin, transcript.start) - transcript.start;
      const to = Math.min(end - transcript.start, bytes.length);
      // Codex numbers its items through the whole transcript, so a turn starts from the count before it.
      if (to > 0) ai(bytes.subarray(from, Math.max(from, to)).toString("utf-8"), next === undefined, codex ? codexNumbering(bytes.subarray(0, from).toString("utf-8")) : undefined);
      aide("aide-after", entries.slice(at + 1, next));
    });
  }

  const claude = tool === "codex" || tool === "opencode" || !/"name":\s*"Agent"/.test(transcript.text) ? new Map() : claudeSubagents(transcript.text);
  const owned = codex && o.codexSession ? spawnsByTurn(turns, transcript.text, o.codexSession) : new Map<AiTurn, Owned[]>();
  const built = aideParts.flatMap((p) =>
    "part" in p ? [p] : aiParts(p, opts, { final: o.final, claude, spawns: owned.get(p) ?? [], reader: o.codexSession }),
  );
  return { logs: built.map((b) => b.part), errors: built.flatMap((b) => b.errors) };
}

/** Which turn each subagent a thread's session file says it started belongs
 *  to: the turn that holds the thread's item the spawn follows, or, for one
 *  counted past the items the transcript holds, the thread's last turn. */
function spawnsByTurn(turns: AiTurn[], text: string, reader: (thread: string) => string | undefined): Map<AiTurn, Owned[]> {
  const out = new Map<AiTurn, Owned[]>();
  const count = (turn: AiTurn | undefined, thread: string, side: "before" | "after") => turn?.[side]?.counts[thread] ?? 0;
  for (const thread of new Set(codexNumbering(text).started)) {
    const sessionText = reader(thread);
    if (sessionText === undefined) continue;
    const touched = turns.filter((t) => count(t, thread, "after") > count(t, thread, "before") || t.after?.started.includes(thread));
    const total = count(turns.at(-1), thread, "after");
    for (const spawn of codexSpawns(sessionText, thread)) {
      const end = spawn.n > total;
      const turn = end
        ? (touched.at(-1) ?? turns.at(-1))
        : turns.find((t) => count(t, thread, "before") < Math.max(spawn.n, 1) && Math.max(spawn.n, 1) <= count(t, thread, "after"));
      if (turn) out.set(turn, [...(out.get(turn) ?? []), { spawn, end }]);
    }
  }
  return out;
}
