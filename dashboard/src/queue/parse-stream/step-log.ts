// A step's Log: the run log (what `aide-run-spec` did) and the transcript
// (what the AI did) merged into parts, in the order things happened.
//
// The run log's grammar, and nothing else about the file:
//   aide-run-spec HH:MM:SS +Ns <text>                                     something the run did
//   aide-run-spec HH:MM:SS +Ns error: <text>                              a failure
//   aide-run-spec HH:MM:SS +Ns model turn started (transcript at byte N)  where the AI's next turn begins
//   aide-run-spec: <text>                                                 an older, unstamped note
//   <anything else>                                                       another script's line on stderr
import { summarizeEntries } from "./entries.ts";
import { linesWithFinalMessage } from "./final-message.ts";
import { esc, type SummarizeOptions } from "./shared.ts";

export interface LogPart {
  /** aide-before: before the AI's first turn. ai: one turn of the AI. aide-after: after a turn
   *  (tests, commit). aide: a finished step that ran no model turn at all. */
  by: "aide-before" | "ai" | "aide-after" | "aide";
  lines: string[]; // already escaped
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

interface Built { part: LogPart; errors: string[] }

export function stepLog(
  transcript: { text: string; start: number },
  runLog: string | undefined,
  o: { tool?: SummarizeOptions["tool"]; final: boolean },
): { logs: LogPart[]; errors: string[] } {
  const opts = { tool: o.tool };
  const built: Built[] = [];
  const aide = (by: LogPart["by"], lines: RunLine[]) => {
    const own = lines.filter((l): l is Extract<RunLine, { text: string }> => !l.turn);
    if (own.length) built.push({ part: { by, lines: own.map((l) => l.text) }, errors: own.filter((l) => l.error).map((l) => l.text) });
  };
  const ai = (text: string, last: boolean) => {
    const lines = last && o.final ? linesWithFinalMessage(text, opts) : summarizeEntries(text, opts).map((e) => e.text);
    if (lines.length) {
      built.push({ part: { by: "ai", lines }, errors: summarizeEntries(text, { ...opts, only: "errors" }).map((e) => e.text) });
    }
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
      if (to > 0) ai(bytes.subarray(from, Math.max(from, to)).toString("utf-8"), next === undefined);
      aide("aide-after", entries.slice(at + 1, next));
    });
  }
  return { logs: built.map((b) => b.part), errors: built.flatMap((b) => b.errors) };
}
