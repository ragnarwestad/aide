// One turn of the AI as the parts a Log shows: the session's lines, split
// around each subagent it started, with the subagent's part under the call.
import { codexSubagent, spawnLine, type Spawn } from "./codex-subagents.ts";
import { finalTail } from "./final-message.ts";
import { summarizeEntries } from "./entries.ts";
import type { ItemNumbering, StreamEntry, SummarizeOptions } from "./shared.ts";
import type { LogPart, SubagentPart } from "./step-log.ts";

/** A turn's slice of the transcript, and where Codex's item numbering stood
 *  before it and after it. */
export interface AiTurn {
  text: string;
  /** The last turn of the step: the one the final message ends. */
  last: boolean;
  before?: ItemNumbering;
  after?: ItemNumbering & { started: string[] };
}

/** A spawn the turn holds: `end` is one counted past the thread's items,
 *  which stands after the turn's last line. */
export interface Owned {
  spawn: Spawn;
  end: boolean;
}

/** Where a spawn goes in its turn: after how many of the turn's entries. */
function positionOf(entries: StreamEntry[], owned: Owned): number {
  if (owned.end) return entries.length;
  const { owner, n } = owned.spawn;
  const at = entries.findLastIndex((e) => e.item?.thread === owner && e.item.n <= n);
  return n === 0 || at < 0 ? 0 : at + 1;
}

export interface BuiltPart {
  part: LogPart;
  errors: string[];
}

/** The parts of one turn. `claude` is the session's subagents by call id,
 *  `spawns` the Codex ones this turn holds, `reader` gives a session file. */
export function aiParts(
  turn: AiTurn,
  opts: SummarizeOptions,
  o: { final: boolean; claude: Map<string, SubagentPart>; spawns: Owned[]; reader?: (thread: string) => string | undefined },
): BuiltPart[] {
  const entries = summarizeEntries(turn.text, { ...opts, only: undefined, numbering: turn.before });
  const texts = entries.map((e) => e.text);
  const tail = turn.last && o.final ? finalTail(texts, turn.text, opts) : undefined;
  const lines = tail ? [...texts.slice(0, tail.kept), ...tail.added] : texts;
  const kept = tail?.kept ?? texts.length;
  // A split is after how many of the lines, the part it puts there and a line of the call, if the stream has none.
  const splits: { at: number; part: SubagentPart; call?: string }[] = [];
  entries.forEach((e, i) => {
    const part = e.call === undefined ? undefined : o.claude.get(e.call);
    if (part) splits.push({ at: i + 1, part });
  });
  for (const owned of o.spawns) {
    splits.push({ at: positionOf(entries, owned), part: codexSubagent(owned.spawn, o.reader?.(owned.spawn.thread)), call: spawnLine(owned.spawn) });
  }
  // Lines the final message replaced stand before the part that followed them.
  const placed = splits.map((s) => ({ ...s, at: s.at > kept ? lines.length : s.at })).sort((a, b) => a.at - b.at);

  const errors = summarizeEntries(turn.text, { ...opts, only: "errors" }).map((e) => e.text);
  const out: BuiltPart[] = [];
  const push = (part: LogPart) => {
    out.push({ part, errors: out.length === 0 ? errors : [] });
  };
  let from = 0;
  for (const s of placed) {
    const own = [...lines.slice(from, s.at), ...(s.call === undefined ? [] : [s.call])];
    if (own.length) push({ by: "ai", lines: own });
    push(s.part);
    from = s.at;
  }
  const rest = lines.slice(from);
  if (rest.length) push({ by: "ai", lines: rest });
  return out;
}
