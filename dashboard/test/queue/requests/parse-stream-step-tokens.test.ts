// The tokens a step used: the usage the stream reported between the step's
// marks, per model call, for the three tools. A tool that reports less often
// than per call gives a step what can be attributed to it, and nothing else.

import { describe, expect, test } from "bun:test";
import { stepLog, stepMarks, stepTokens } from "../../../src/queue/parse-stream";

const line = (o: unknown) => JSON.stringify(o);
const text = (t: string) => ({ type: "text", text: t });
const tool = { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } };

type Use = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
const use = (input: number, output: number, read: number, create: number): Use => ({
  input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: create,
});
const total = (u: Use) => u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens;

/** One content block of Claude message `id`, with the message's usage. */
const block = (id: string, content: unknown, usage?: Use, extra: Record<string, unknown> = {}) =>
  line({ type: "assistant", ...extra, message: { id, content: [content], ...(usage ? { usage } : {}) } });

const start = (n: number) => `--- Step ${n} of 4: Step ${n} — started`;
const done = (n: number) => `--- Step ${n} of 4: Step ${n} — done`;
const KEY = (n: number) => `Step ${n} of 4`;
const claude = (...events: string[]) => stepTokens(events.join("\n") + "\n", "claude");

describe("stepTokens: Claude", () => {
  const BEFORE = use(1000, 100, 0, 0);
  const U1 = use(10, 3, 700, 40);
  const U2 = use(20, 5, 800, 0);
  const U3 = use(30, 7, 900, 60);
  const AFTER = use(5000, 500, 0, 0);

  test("a step holds the messages from its started mark to its done mark, each counted once however many events it wrote", () => {
    const got = claude(
      block("m0", text("before"), BEFORE),
      // one message, three events with one usage; the mark is in the second
      block("m1", { type: "thinking", thinking: "…" }, U1),
      block("m1", text(start(1)), U1),
      block("m1", tool, U1),
      block("m2", text("middle"), U2),
      block("m3", text(done(1)), U3),
      block("m4", text("after"), AFTER),
    );
    expect(got.get(KEY(1))).toBe(total(U1) + total(U2) + total(U3));
  });

  test("another step's started mark ends the open step, and the call that opens it is its own", () => {
    const got = claude(
      block("m1", text(start(1)), U1),
      block("m2", text("one"), U2),
      block("m3", text(start(2)), U3),
      block("m4", text("two"), U2),
      block("m5", text(done(2)), U1),
    );
    expect(got.get(KEY(1))).toBe(total(U1) + total(U2));
    expect(got.get(KEY(2))).toBe(total(U3) + total(U2) + total(U1));
  });

  test("a subagent's calls inside a step are the step's", () => {
    const got = claude(
      block("m1", text(start(1)), U1),
      block("s1", text("subagent"), U2, { parent_tool_use_id: "toolu_1" }),
      block("m2", text(done(1)), U3),
    );
    expect(got.get(KEY(1))).toBe(total(U1) + total(U2) + total(U3));
  });

  test("a step left open when a new session starts takes nothing from it", () => {
    const init = line({ type: "system", subtype: "init", session_id: "s2" });
    const got = claude(block("m1", text(start(1)), U1), init, block("m2", text("review"), U2), block("m3", text("fix"), U3));
    expect(got.get(KEY(1))).toBe(total(U1));
  });

  test("a later step's skipped mark ends the open step, so the usage after it is not the step's (AC-3)", () => {
    const got = claude(
      block("m1", text(start(1)), U1),
      block("m2", text("--- Step 2 of 4: Step 2 — skipped: nothing to do"), U2),
      block("m3", text("later"), U3),
    );
    expect(got.get(KEY(1))).toBe(total(U1) + total(U2));
    expect(got.has(KEY(2))).toBe(false);
  });

  test("one message is counted once when a subagent's events come between its content blocks (AC-4)", () => {
    const sub = { parent_tool_use_id: "toolu_1" };
    const got = claude(
      block("m1", text(start(1)), U1),
      block("s1", text("subagent"), U2, sub),
      block("m1", tool, U1),
      block("s2", text("subagent"), U3, sub),
      block("m1", tool, U1),
      block("m2", text(done(1)), AFTER),
    );
    expect(got.get(KEY(1))).toBe(total(U1) + total(U2) + total(U3) + total(AFTER));
  });

  test("a message whose first block comes before the step's start mark still gives the step its usage once (AC-4)", () => {
    const sub = { parent_tool_use_id: "toolu_1" };
    const got = claude(
      block("m1", text("thinking aloud"), U1),
      block("s1", text("subagent"), U2, sub),
      block("m1", text(start(1)), U1),
      block("m2", text(done(1)), U3),
    );
    expect(got.get(KEY(1))).toBe(total(U1) + total(U3));
  });

  test("a step with no usage between its marks has no entry, and a transcript with no marks gives none", () => {
    const got = claude(block("m1", text(start(1))), block("m2", text(done(1))), block("m3", text(start(2)), U1), block("m4", text(done(2))));
    expect(got.has(KEY(1))).toBe(false);
    expect(got.get(KEY(2))).toBe(total(U1));
    expect(claude(block("m1", text("work"), U1)).size).toBe(0);
  });
});

describe("stepTokens: opencode", () => {
  const S = "ses_1";
  const begin = line({ type: "step_start", sessionID: S, part: { type: "step-start" } });
  const said = (t: string) => line({ type: "text", sessionID: S, part: { type: "text", text: t } });
  const finish = (input: number, output: number, reasoning: number, read: number, write: number) =>
    line({ type: "step_finish", sessionID: S, part: { type: "step-finish", tokens: { input, output, reasoning, cache: { read, write } } } });

  test("a step holds the model steps from the one with its started mark to the one with its done mark: input, output with reasoning, cache read and write", () => {
    const got = stepTokens(
      [
        begin, said("before"), finish(900, 90, 9, 0, 0),
        begin, said(start(1)), finish(100, 20, 5, 50, 7),
        begin, said(done(1)), finish(10, 2, 1, 5, 3),
        begin, said("after"), finish(800, 80, 8, 0, 0),
      ].join("\n") + "\n",
      "opencode",
    );
    expect(got.get(KEY(1))).toBe(100 + 20 + 5 + 50 + 7 + (10 + 2 + 1 + 5 + 3));
  });
});

describe("stepTokens: Codex", () => {
  const usage = (input: number, output: number, reasoning: number, cached: number) => ({
    input_tokens: input, output_tokens: output, reasoning_output_tokens: reasoning, cached_input_tokens: cached,
  });
  const said = (t: string) => line({ type: "item.completed", item: { id: "i", type: "agent_message", text: t } });
  const turn = (...inside: string[]) => (u: ReturnType<typeof usage>) =>
    [line({ type: "turn.started" }), ...inside, line({ type: "turn.completed", usage: u })];
  const codex = (...events: string[]) => stepTokens(events.join("\n") + "\n", "codex");

  test("a turn that holds the step's marks inside it counts for no step", () => {
    const got = codex(...turn(said(start(1)), said(done(1)))(usage(100, 20, 5, 50)));
    expect(got.has(KEY(1))).toBe(false);
  });

  test("a turn that begins after the step started and ends before it did counts for it whole", () => {
    const got = codex(
      ...turn(said(start(1)))(usage(1, 1, 1, 1)),
      ...turn(said("middle"))(usage(100, 20, 5, 50)),
      ...turn(said(done(1)))(usage(2, 2, 2, 2)),
    );
    expect(got.get(KEY(1))).toBe(100 + 20 + 5 + 50);
  });
});

describe("a step's tokens on the step marks", () => {
  const stamp = (s: number, t: string) => `aide-run-spec 10:45:0${s} +${s}s ${t}`;
  const U = use(10, 3, 700, 40);
  const transcript = [block("m1", text(start(1)), U), block("m2", text(done(1)), U)].join("\n") + "\n";
  const marks = (runLog: string) => {
    const { logs } = stepLog({ text: transcript, start: 0 }, runLog, { tool: "claude", final: true });
    return stepMarks(logs, stepTokens(transcript, "claude"));
  };

  test("a mark with a recorded time carries the step's tokens", () => {
    const runLog = [stamp(0, "lock"), stamp(1, "model turn started (transcript at byte 0)"), stamp(2, start(1)), stamp(5, done(1))].join("\n") + "\n";
    expect(marks(runLog).find((m) => m.key === KEY(1))!.tokens).toBe(2 * total(U));
  });

  test("a run from before has no recorded time on its marks and so no tokens, whatever its transcript holds", () => {
    const runLog = [stamp(0, "lock"), stamp(1, "model turn started (transcript at byte 0)")].join("\n") + "\n";
    const mark = marks(runLog).find((m) => m.key === KEY(1))!;
    expect(mark.startedSec).toBeUndefined();
    expect(mark.tokens).toBeUndefined();
  });
});

// The three readers over the same transcript: every step's time and tokens must be what its marks give,
// whatever the length of its title and wherever a subagent's events stand.
describe("a step's time and tokens over every length of title", () => {
  const result = (t: string) => line({ type: "result", subtype: "success", result: t });
  const stamp = (s: number, t: string) => `aide-run-spec 10:45:00 +${s}s ${t}`;
  const agent = (id: string) => ({ type: "tool_use", id, name: "Agent", input: { description: "look", subagent_type: "general-purpose", prompt: "look" } });
  const mark = (n: number, length: number, ending: string) => `--- Step ${n} of 4: ${"t".repeat(length)} — ${ending}`;
  const LENGTHS = [5, 60, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 160, 200, 400];

  /** What the three readers say about a transcript and its run log, one entry per step. */
  const read = (events: string[], runLog: string[], final: boolean) => {
    const transcript = events.join("\n") + "\n";
    const log = runLog.join("\n") + "\n";
    const { logs } = stepLog({ text: transcript, start: 0 }, log, { tool: "claude", final });
    return stepMarks(logs, stepTokens(transcript, "claude")).map((m) => ({ key: m.key, state: m.state, startedSec: m.startedSec, endedSec: m.endedSec, tokens: m.tokens }));
  };

  /** Steps with titles of the given lengths, each three messages with a usage of their own. */
  const plain = (lengths: number[], final: boolean) => {
    let n = 0;
    const events = [block("m0", text("before"), use(1000, 100, 0, 0))];
    const runLog = [stamp(0, "lock"), stamp(1, "model turn started (transcript at byte 0)")];
    const want: ReturnType<typeof read> = [];
    lengths.forEach((length, i) => {
      const step = i + 1;
      const [a, b, c] = [use(++n, 1, 0, 0), use(++n, 2, 0, 0), use(++n, 3, 0, 0)];
      events.push(block(`m${step}a`, text(mark(step, length, "started")), a), block(`m${step}b`, text("work"), b), block(`m${step}c`, text(mark(step, length, "done")), c));
      runLog.push(stamp(10 * step, mark(step, length, "started")), stamp(10 * step + 5, mark(step, length, "done")));
      want.push({ key: KEY(step), state: "done", startedSec: 10 * step, endedSec: 10 * step + 5, tokens: total(a) + total(b) + total(c) });
    });
    if (final) events.push(result(mark(lengths.length, lengths.at(-1)!, "done")));
    return { got: read(events, runLog, final), want };
  };

  for (const final of [false, true]) {
    test(`titles from 5 to 400 characters, long and short steps mixed, give each step its time and tokens (final ${final}) (AC-1, AC-6)`, () => {
      for (const length of LENGTHS) {
        for (const lengths of [[length, 5, length], [5, length, 5]]) {
          const { got, want } = plain(lengths, final);
          expect({ lengths, got }).toEqual({ lengths, got: want });
        }
      }
    });

    test(`parallel subagent calls between one message's content blocks leave each step's time and tokens as its marks give them (final ${final}) (AC-4, AC-6)`, () => {
      for (const length of [5, 200]) {
        const [u1, ua, ub, u4] = [use(10, 1, 0, 0), use(20, 2, 0, 0), use(30, 3, 0, 0), use(40, 4, 0, 0)];
        const events = [
          block("m1", text(mark(1, length, "started")), u1),
          block("m1", agent("toolu_a"), u1),
          block("sa", text("first subagent"), ua, { parent_tool_use_id: "toolu_a" }),
          block("m1", agent("toolu_b"), u1),
          block("sb", text("second subagent"), ub, { parent_tool_use_id: "toolu_b" }),
          block("m1", tool, u1),
          block("m2", text(mark(1, length, "done")), u4),
        ];
        if (final) events.push(result(mark(1, length, "done")));
        const runLog = [stamp(0, "lock"), stamp(1, "model turn started (transcript at byte 0)"), stamp(10, mark(1, length, "started")), stamp(40, mark(1, length, "done"))];
        expect({ length, got: read(events, runLog, final) }).toEqual({
          length,
          got: [{ key: KEY(1), state: "done", startedSec: 10, endedSec: 40, tokens: total(u1) + total(ua) + total(ub) + total(u4) }],
        });
      }
    });
  }
});
