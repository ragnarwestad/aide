// `stepLog`: the run log (Aide's own lines) and the transcript (the AI's)
// merged into parts, in the order things happened. The transcript is cut at
// the byte each turn line names; the grammar of the run log is read here.

import { describe, expect, test } from "bun:test";
import { stepLog, stepMarks, stepSlices, type LogPart, type SubagentPart } from "../../../src/queue/parse-stream";
import { feasibility, lines as fileOf, ran, S, S2, sAgent, sDone, sEdit, sRan, sSpawn, started, said as codexSaid, T } from "../../helpers/codex-fixtures.ts";

const line = (o: unknown) => JSON.stringify(o);
const say = (text: string) => line({ type: "assistant", message: { content: [{ type: "text", text }] } });
const bash = (id: string, command: string) =>
  line({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
const failed = (id: string) =>
  line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: true }] } });
const result = (text: string) => line({ type: "result", subtype: "success", result: text });

const stamp = (s: number, text: string) => `aide-run-spec 10:45:0${s} +${s}s ${text}`;
const turn = (offset?: number) => stamp(3, offset === undefined ? "model turn started" : `model turn started (transcript at byte ${offset})`);
const bytes = (s: string) => Buffer.byteLength(s);

const read = (transcript: string, runLog: string | undefined, o: { final?: boolean; start?: number } = {}) =>
  stepLog({ text: transcript, start: o.start ?? 0 }, runLog, { tool: "claude", final: o.final ?? true });
const by = (parts: LogPart[]) => parts.map((p) => p.by);

describe("stepLog: the order of the parts", () => {
  test("Aide's lines before, the AI's turn, Aide's lines after, with the turn line in none", () => {
    const transcript = [say("one"), say("two"), say("three")].join("\n") + "\n";
    const runLog = [stamp(0, "waiting for the checkout lock"), stamp(1, "fetching main"), turn(0), stamp(9, "the project's tests are green"), stamp(9, "committing in /x")].join("\n") + "\n";
    const { logs } = read(transcript, runLog, { final: false });

    expect(by(logs)).toEqual(["aide-before", "ai", "aide-after"]);
    expect(logs[0]!.lines).toEqual(["10:45:00 +0s waiting for the checkout lock", "10:45:01 +1s fetching main"]);
    expect(logs[1]!.lines).toEqual(["one", "two", "three"]);
    expect(logs[2]!.lines).toEqual(["10:45:09 +9s the project's tests are green", "10:45:09 +9s committing in /x"]);
    expect(JSON.stringify(logs)).not.toContain("model turn started");
  });

  test("two turns with Norwegian text are cut at their byte offsets", () => {
    const one = [say("første æøå"), bash("a", "bun test")].join("\n") + "\n";
    const two = [say("andre æøå")].join("\n") + "\n";
    const runLog = [stamp(0, "lock"), turn(0), stamp(5, "error: the tests are red"), turn(bytes(one)), stamp(9, "the project's tests are green"), stamp(9, "committing in /x")].join("\n");
    const { logs } = read(one + two, runLog, { final: false });

    expect(by(logs)).toEqual(["aide-before", "ai", "aide-after", "ai", "aide-after"]);
    expect(logs[1]!.lines).toEqual(["første æøå", "Bash bun test"]);
    expect(logs[3]!.lines).toEqual(["andre æøå"]);
    expect(logs[4]!.lines).toHaveLength(2);
  });

  test("a tail that begins inside turn 2 drops turn 1 and keeps every Aide part; one that begins at turn 2 keeps it whole", () => {
    const one = [say("første æøå"), say("mer æøå")].join("\n") + "\n";
    const two = [say("andre æøå"), say("slutt æøå")].join("\n") + "\n";
    const runLog = [stamp(0, "lock"), turn(0), stamp(5, "red"), turn(bytes(one)), stamp(9, "green")].join("\n");
    const firstLineOfTwo = bytes(say("andre æøå") + "\n");

    const tailFrom = (start: number) => Buffer.from(one + two).subarray(start).toString();
    const cut = read(tailFrom(bytes(one) + firstLineOfTwo), runLog, { final: false, start: bytes(one) + firstLineOfTwo });
    expect(by(cut.logs)).toEqual(["aide-before", "aide-after", "ai", "aide-after"]);
    expect(cut.logs[2]!.lines).toEqual(["slutt æøå"]);

    const whole = read(tailFrom(bytes(one)), runLog, { final: false, start: bytes(one) });
    expect(whole.logs.filter((p) => p.by === "ai").map((p) => p.lines)).toEqual([["andre æøå", "slutt æøå"]]);
  });

  test("a step with no run log is the transcript as one ai part", () => {
    const { logs } = read([say("one"), say("two")].join("\n"), undefined, { final: false });
    expect(by(logs)).toEqual(["ai"]);
    expect(logs[0]!.lines).toEqual(["one", "two"]);
  });

  test("a turn line with no offset puts the whole transcript in one ai part between the stretches", () => {
    const runLog = [stamp(0, "lock"), turn(), stamp(9, "green")].join("\n");
    const { logs } = read([say("one"), say("two")].join("\n"), runLog, { final: false });
    expect(by(logs)).toEqual(["aide-before", "ai", "aide-after"]);
    expect(logs[1]!.lines).toEqual(["one", "two"]);
  });

  test("a finished step that ran no turn is one aide part; a running one is aide-before", () => {
    const runLog = [stamp(0, "lock"), stamp(1, "fetching main")].join("\n");
    expect(by(read("", runLog, { final: true }).logs)).toEqual(["aide"]);
    expect(by(read("", runLog, { final: false }).logs)).toEqual(["aide-before"]);
    expect(read("", runLog, { final: true }).logs[0]!.lines).toHaveLength(2);
  });

  test("a running step has aide-before and ai, and no final message is added", () => {
    const transcript = [bash("a", "x"), say("almost")].join("\n") + "\n" + result("done");
    const { logs } = read(transcript, [stamp(0, "lock"), turn(0)].join("\n"), { final: false });
    expect(by(logs)).toEqual(["aide-before", "ai"]);
    expect(logs[1]!.lines).toEqual(["Bash x", "almost"]);
  });

  test("an unstamped note loses its prefix and any other line is shown as it is", () => {
    const runLog = ["aide-run-spec: an older note", "Worktree links: read from x", turn(0)].join("\n");
    expect(read(say("a"), runLog, { final: false }).logs[0]!.lines).toEqual(["an older note", "Worktree links: read from x"]);
  });
});

describe("stepLog: the final message", () => {
  test("every turn's message is shown whole, and the final one once", () => {
    const long = `${"word ".repeat(60)}end`;
    const one = [say(long)].join("\n") + "\n";
    const two = [bash("a", "x"), say("All done.")].join("\n") + "\n" + result("All done.");
    const runLog = [turn(0), stamp(5, "red"), turn(bytes(one))].join("\n");
    const { logs } = read(one + two, runLog);
    const ai = logs.filter((p) => p.by === "ai");

    expect(ai[0]!.lines[0]).toBe(long);
    expect(ai[1]!.lines).toEqual(["Bash x", "All done."]);
  });

  test("a message over several paragraphs keeps its line breaks, and a step mark in it stays a line of its own", () => {
    const message = "First paragraph.\n\nSecond paragraph.\n--- Step 2 of 10: Detect complexity — started";
    const { logs } = read([say(message), bash("a", "x")].join("\n") + "\n", undefined, { final: false });
    expect(logs[0]!.lines).toEqual(["First paragraph.\n\nSecond paragraph.", "--- Step 2 of 10: Detect complexity — started", "Bash x"]);
  });
});

describe("stepLog: the error lines", () => {
  test("the failed command and Aide's flagged line, in the order they happened, and nothing else", () => {
    const transcript = [bash("a", "bun test"), failed("a"), bash("b", "git status")].join("\n") + "\n";
    const runLog = [stamp(0, "lock"), turn(0), stamp(5, "error: the tests are red — handing them back")].join("\n");
    const { errors } = read(transcript, runLog, { final: false });

    expect(errors).toEqual(["Bash bun test", "10:45:05 +5s error: the tests are red — handing them back"]);
  });
});

// A Claude session's own events carry `parent_tool_use_id: null`; a subagent's carry the id of the call that started it.
const by_ = (parent: string | null, o: Record<string, unknown>) => line({ ...o, parent_tool_use_id: parent });
const sayBy = (parent: string | null, text: string) => by_(parent, { type: "assistant", message: { content: [{ type: "text", text }] } });
const bashBy = (parent: string | null, id: string, command: string) =>
  by_(parent, { type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
const agent = (id: string, input: Record<string, unknown>, parent: string | null = null) =>
  by_(parent, { type: "assistant", message: { content: [{ type: "tool_use", id, name: "Agent", input }] } });
const handedBack = (id: string, text: string) =>
  by_(null, {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: `[Subagent hand-back] The report follows:\n  ${text}` }] }] },
    tool_use_result: { status: "completed", content: [{ type: "text", text }] },
  });
const launched = (id: string) =>
  by_(null, {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: "Async agent launched successfully." }] }] },
    tool_use_result: { status: "async_launched", agentId: "x" },
  });
const notified = (id: string, summary: string) => line({ type: "system", subtype: "task_notification", tool_use_id: id, status: "completed", summary });

const subagents = (parts: LogPart[]) => parts.filter((p): p is SubagentPart => p.by === "subagent");
const linesOf = (parts: LogPart[], by: LogPart["by"]) => parts.filter((p) => p.by === by).flatMap((p) => p.lines);
const review = { description: "Feasibility review", prompt: "Read the plan" };
const one = () => [say("before"), agent("A", review), sayBy("A", "reading"), bashBy("A", "b1", "ls"), say("after")];
const claude = (events: string[], o: { final?: boolean } = {}) => read(events.join("\n") + "\n", undefined, { final: o.final ?? false });

describe("stepLog: a Claude subagent's own part", () => {
  test("its lines leave the session's, and the session goes on after its part", () => {
    const { logs } = claude(one());

    expect(by(logs)).toEqual(["ai", "subagent", "ai"]);
    expect(logs[0]!.lines).toEqual(["before", "Agent Read the plan"]);
    const [part] = subagents(logs);
    expect(part!.name).toBe("Feasibility review");
    expect(part!.lines).toEqual(["reading", "Bash ls"]);
    expect(logs[2]!.lines).toEqual(["after"]);
    expect(linesOf(logs, "ai").join("\n")).not.toContain("reading");
    expect(linesOf(logs, "ai").join("\n")).not.toContain("Bash ls");
  });

  test("two calls whose events alternate each keep their own, under their own call", () => {
    const { logs } = claude([
      agent("A", { description: "First", prompt: "do a" }),
      agent("B", { description: "Second", prompt: "do b" }),
      sayBy("A", "a1"), sayBy("B", "b1"), sayBy("A", "a2"), sayBy("B", "b2"),
    ]);

    expect(by(logs)).toEqual(["ai", "subagent", "ai", "subagent"]);
    expect(logs[0]!.lines).toEqual(["Agent do a"]);
    expect(logs[1]!.lines).toEqual(["a1", "a2"]);
    expect(logs[2]!.lines).toEqual(["Agent do b"]);
    expect(logs[3]!.lines).toEqual(["b1", "b2"]);
  });

  test("a subagent's own subagent stays in its part", () => {
    const { logs } = claude([agent("A", review), agent("C", { description: "Deeper", prompt: "go deeper" }, "A"), sayBy("C", "deep")]);

    expect(subagents(logs)).toHaveLength(1);
    expect(subagents(logs)[0]!.lines).toEqual(["Agent go deeper", "deep"]);
    expect(linesOf(logs, "ai").join("\n")).not.toContain("deep");
  });

  test("a subagent's failed call is still in the errors, as it was", () => {
    const { errors } = claude([...one(), failed("b1")]);

    expect(errors).toEqual(["Bash ls"]);
  });

  test("a step with no Agent call is the ai part it always was", () => {
    const { logs } = claude([say("one"), bashBy(null, "a", "ls"), failed("a")]);

    expect(logs).toEqual([{ by: "ai", lines: ["one", "Bash ls"] }]);
  });

  test("it is named by its description, else its type, and asked what the call's prompt said", () => {
    const { logs } = claude([agent("A", review), agent("B", { subagent_type: "Explore", prompt: "Look <here>" })]);

    expect(subagents(logs).map((p) => p.name)).toEqual(["Feasibility review", "Explore"]);
    expect(subagents(logs)[0]!.asked).toBe("Read the plan");
    expect(subagents(logs)[1]!.asked).toBe("Look &lt;here&gt;");
  });

  test("a foreground call's result is its answer", () => {
    const { logs } = claude([...one(), handedBack("A", "Two must-fix & one more")]);

    expect(subagents(logs)[0]!.asked).toBe("Read the plan");
    expect(subagents(logs)[0]!.answer).toBe("Two must-fix &amp; one more");
  });

  test("a background call's answer is its notification, not the launch message", () => {
    const { logs } = claude([...one(), launched("A"), notified("A", "No must-fix")]);

    expect(subagents(logs)[0]!.answer).toBe("No must-fix");
  });

  test("a background call with no notification yet has no answer, and the launch message is nowhere", () => {
    const { logs } = claude([...one(), launched("A")]);

    expect(subagents(logs)[0]!.answer).toBeUndefined();
    expect(JSON.stringify(logs)).not.toContain("Async agent launched");
  });

  test("a call with no result and no notification has no answer", () => {
    expect(subagents(claude(one()).logs)[0]!.answer).toBeUndefined();
  });

  test("a last line that only repeats the answer is the answer, once", () => {
    const { logs } = claude([agent("A", review), sayBy("A", "reading"), sayBy("A", "Two must-fix"), handedBack("A", "Two must-fix")]);

    expect(subagents(logs)[0]!.answer).toBe("Two must-fix");
    expect(subagents(logs)[0]!.lines).toEqual(["reading"]);
  });
});

describe("stepLog: a Codex subagent's own part", () => {
  const stream = (events: unknown[]) => fileOf(events);
  /** A reader holding the files it is given, by thread id. */
  const files = (held: Record<string, unknown[]>) => (thread: string) => (held[thread] ? fileOf(held[thread]!) : undefined);
  const codex = (transcript: string, reader?: (thread: string) => string | undefined, runLog?: string) =>
    stepLog({ text: transcript, start: 0 }, runLog, { tool: "codex", final: false, ...(reader ? { codexSession: reader } : {}) });
  const own = [started(T), codexSaid("m1"), ran("c1"), codexSaid("m2")];

  test("the call's line and the subagent's part stand where the session made the call", () => {
    const { logs } = codex(stream(own), files({ [T]: feasibility.parent, [S]: feasibility.child }));

    expect(by(logs)).toEqual(["ai", "subagent", "ai"]);
    expect(logs[0]!.lines).toEqual(["m1", "c1", "spawn_agent feasibility"]);
    expect(subagents(logs)[0]!.name).toBe("feasibility");
    expect(subagents(logs)[0]!.lines).toEqual(["/bin/zsh -lc cat plan.md", "looks fine"]);
    expect(subagents(logs)[0]!.asked).toBeUndefined();
    expect(logs[2]!.lines).toEqual(["m2"]);
  });

  test("a spawn counted past the first turn stands in the turn that holds its item", () => {
    const first = stream([started(T), codexSaid("a1"), codexSaid("a2")]);
    const second = stream([started(T), codexSaid("b1"), codexSaid("b2")]);
    const parent = [sAgent("a1"), sAgent("a2"), sAgent("b1"), sSpawn(S, "/root/feasibility"), sAgent("b2")];
    const runLog = [turn(0), turn(bytes(first))].join("\n");
    const { logs } = codex(first + second, files({ [T]: parent, [S]: feasibility.child }), runLog);

    expect(by(logs)).toEqual(["ai", "ai", "subagent", "ai"]);
    expect(logs[0]!.lines).toEqual(["a1", "a2"]);
    expect(logs[1]!.lines).toEqual(["b1", "spawn_agent feasibility"]);
    expect(logs[3]!.lines).toEqual(["b2"]);
  });

  test("a spawn counted past the last item the transcript holds stands after the last turn's last line", () => {
    const first = stream([started(T), codexSaid("a1")]);
    const second = stream([started(T), codexSaid("b1")]);
    const parent = [sAgent("a1"), sAgent("b1"), sAgent("later"), sSpawn(S, "/root/feasibility")];
    const runLog = [turn(0), turn(bytes(first))].join("\n");
    const { logs } = codex(first + second, files({ [T]: parent, [S]: feasibility.child }), runLog);

    expect(by(logs)).toEqual(["ai", "ai", "subagent"]);
    expect(logs[1]!.lines).toEqual(["b1", "spawn_agent feasibility"]);
  });

  test("two spawns each get a call line and a part, in order", () => {
    const parent = [sAgent("m1"), sSpawn(S, "/root/feasibility"), sSpawn(S2, "/root/scope"), sAgent("m2")];
    const { logs } = codex(stream([started(T), codexSaid("m1"), codexSaid("m2")]), files({ [T]: parent, [S]: feasibility.child }));

    expect(by(logs)).toEqual(["ai", "subagent", "ai", "subagent", "ai"]);
    expect(logs[2]!.lines).toEqual(["spawn_agent scope"]);
    expect(subagents(logs)[1]!.unread).toEqual({ thread: S2 });
  });

  test("a subagent's file with two task_complete events answers with the last, once", () => {
    const child = [sRan("ls"), sDone("Partial"), sAgent("Ready"), sDone("Ready")];
    const { logs } = codex(stream(own), files({ [T]: feasibility.parent, [S]: child }));
    const [part] = subagents(logs);

    expect(part!.asked).toBeUndefined();
    expect(part!.name).toBe("feasibility");
    expect(part!.answer).toBe("Ready");
    expect(part!.lines).toEqual(["ls"]);
  });

  test("an edit is `edit <paths>`, as the stream's own is", () => {
    const child = [sEdit("/x/a.ts", "/x/b.ts")];
    const { logs } = codex(stream(own), files({ [T]: feasibility.parent, [S]: child }));

    expect(subagents(logs)[0]!.lines).toEqual(["edit /x/a.ts, /x/b.ts"]);
  });

  test("a subagent whose file cannot be read is a part that says so, and the rest of the log is as before", () => {
    const without = codex(stream(own));
    const { logs } = codex(stream(own), files({ [T]: feasibility.parent }));
    const [part] = subagents(logs);

    expect(part).toMatchObject({ name: "feasibility", unread: { thread: S }, lines: [] });
    const rest = logs.filter((p) => p.by === "ai").flatMap((p) => p.lines).filter((l) => !l.startsWith("spawn_agent"));
    expect(rest).toEqual(without.logs.flatMap((p) => p.lines));
  });

  test("a file in which nothing parses is unread too", () => {
    const { logs } = codex(stream(own), (thread) => (thread === T ? fileOf(feasibility.parent) : "not json\n"));

    expect(subagents(logs)[0]!.unread).toEqual({ thread: S });
  });

  test("a session file with no spawn, or no reader, or a reader that gives nothing, leaves the parts as they are", () => {
    const plain = codex(stream(own)).logs;

    expect(codex(stream(own), files({ [T]: [sAgent("m1"), sRan("c1"), sDone("x")] })).logs).toEqual(plain);
    expect(codex(stream(own), () => undefined).logs).toEqual(plain);
    expect(plain).toEqual([{ by: "ai", lines: ["m1", "c1", "m2"] }]);
  });

  test("only a spawn that started counts, not a later word about the same subagent", () => {
    const parent = [sAgent("m1"), sSpawn(S, "/root/feasibility"), sSpawn(S, "/root/feasibility", "completed")];
    const { logs } = codex(stream(own), files({ [T]: parent, [S]: feasibility.child }));

    expect(subagents(logs)).toHaveLength(1);
  });
});

// `aide-run-spec` writes each mark the model writes into the run log with its time, as it
// sees it. The Log shows it once: the model's own line, with that stamp in front.
describe("stepLog: the stamp on a mark the model wrote", () => {
  const A = "--- Step 1 of 4: Read — started";
  const B = "--- Step 1 of 4: Read — done";
  const transcript = [say(A), say("worked"), say(B)].join("\n") + "\n";
  const runLog = (...marks: string[]) => [stamp(0, "lock"), turn(0), ...marks, stamp(9, "the project's tests are green")].join("\n") + "\n";
  const aiLines = (logs: LogPart[]) => logs.filter((p) => p.by === "ai").flatMap((p) => p.lines);
  const aideLines = (logs: LogPart[]) => logs.filter((p) => p.by !== "ai" && p.by !== "subagent").flatMap((p) => p.lines);

  test("each mark is one line, the model's own, with its recorded time in front", () => {
    const { logs } = read(transcript, runLog(stamp(2, A), stamp(7, B)), { final: false });
    expect(aiLines(logs)).toEqual([`10:45:02 +2s ${A}`, "worked", `10:45:07 +7s ${B}`]);
    expect(aideLines(logs).join("\n")).not.toContain("Read");
  });

  test("the time reaches the step and the slices cut at the marks hold what lies between them", () => {
    const { logs } = read(transcript, runLog(stamp(2, A), stamp(7, B)), { final: false });
    expect(stepMarks(logs)[0]).toMatchObject({ key: "Step 1 of 4", state: "done", startedSec: 2, endedSec: 7 });
    // Aide's lines before the first mark and after the last stand in the step's slice too.
    expect(aiLines(stepSlices(logs).get("Step 1 of 4")!)).toEqual([`10:45:02 +2s ${A}`, "worked", `10:45:07 +7s ${B}`]);
  });

  test("the same mark written twice takes the stamps in the order they were recorded", () => {
    const twice = [say(A), say(B), say(A)].join("\n") + "\n";
    const { logs } = read(twice, runLog(stamp(1, A), stamp(2, B), stamp(5, A)), { final: false });
    expect(aiLines(logs)).toEqual([`10:45:01 +1s ${A}`, `10:45:02 +2s ${B}`, `10:45:05 +5s ${A}`]);
  });

  test("a stamped mark no line of the model matches stays among Aide's lines", () => {
    const merge = "--- Step 11 of 11: Merge into main — started";
    const { logs } = read(transcript, runLog(stamp(2, A), stamp(7, B), stamp(8, merge)), { final: false });
    expect(aideLines(logs)).toContain(`10:45:08 +8s ${merge}`);
    expect(aiLines(logs)).toEqual([`10:45:02 +2s ${A}`, "worked", `10:45:07 +7s ${B}`]);
  });

  test("a long mark is the model's whole line with its recorded time in front, once, and no line of Aide's holds it", () => {
    const long = `--- Step 2 of 4: ${"x".repeat(200)} — started`;
    const { logs } = read(say(long) + "\n", runLog(stamp(3, long)), { final: false });
    expect(aiLines(logs)).toEqual([`10:45:03 +3s ${long}`]);
    expect(aideLines(logs).filter((l) => l.includes("xxxx"))).toEqual([]);
    expect(stepMarks(logs)[0]).toMatchObject({ key: "Step 2 of 4", startedSec: 3 });
  });

  test("a run log with no stamped marks leaves the model's lines as written", () => {
    const { logs } = read(transcript, runLog(), { final: false });
    expect(aiLines(logs)).toEqual([A, "worked", B]);
    expect(stepMarks(logs)[0]!.startedSec).toBeUndefined();
  });
});
