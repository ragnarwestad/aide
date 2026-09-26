// `stepLog`: the run log (Aide's own lines) and the transcript (the AI's)
// merged into parts, in the order things happened. The transcript is cut at
// the byte each turn line names; the grammar of the run log is read here.

import { describe, expect, test } from "bun:test";
import { stepLog, type LogPart } from "../../../src/queue/parse-stream";

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
  test("Aide's lines before, the AI's turn, Aide's lines after, with the turn line in none (AC-3)", () => {
    const transcript = [say("one"), say("two"), say("three")].join("\n") + "\n";
    const runLog = [stamp(0, "waiting for the checkout lock"), stamp(1, "fetching main"), turn(0), stamp(9, "the project's tests are green"), stamp(9, "committing in /x")].join("\n") + "\n";
    const { logs } = read(transcript, runLog, { final: false });

    expect(by(logs)).toEqual(["aide-before", "ai", "aide-after"]);
    expect(logs[0]!.lines).toEqual(["10:45:00 +0s waiting for the checkout lock", "10:45:01 +1s fetching main"]);
    expect(logs[1]!.lines).toEqual(["one", "two", "three"]);
    expect(logs[2]!.lines).toEqual(["10:45:09 +9s the project's tests are green", "10:45:09 +9s committing in /x"]);
    expect(JSON.stringify(logs)).not.toContain("model turn started");
  });

  test("two turns with Norwegian text are cut at their byte offsets (AC-3)", () => {
    const one = [say("første æøå"), bash("a", "bun test")].join("\n") + "\n";
    const two = [say("andre æøå")].join("\n") + "\n";
    const runLog = [stamp(0, "lock"), turn(0), stamp(5, "error: the tests are red"), turn(bytes(one)), stamp(9, "the project's tests are green"), stamp(9, "committing in /x")].join("\n");
    const { logs } = read(one + two, runLog, { final: false });

    expect(by(logs)).toEqual(["aide-before", "ai", "aide-after", "ai", "aide-after"]);
    expect(logs[1]!.lines).toEqual(["første æøå", "Bash bun test"]);
    expect(logs[3]!.lines).toEqual(["andre æøå"]);
    expect(logs[4]!.lines).toHaveLength(2);
  });

  test("a tail that begins inside turn 2 drops turn 1 and keeps every Aide part; one that begins at turn 2 keeps it whole (AC-3)", () => {
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

  test("a step with no run log is the transcript as one ai part (AC-3)", () => {
    const { logs } = read([say("one"), say("two")].join("\n"), undefined, { final: false });
    expect(by(logs)).toEqual(["ai"]);
    expect(logs[0]!.lines).toEqual(["one", "two"]);
  });

  test("a turn line with no offset puts the whole transcript in one ai part between the stretches (AC-3)", () => {
    const runLog = [stamp(0, "lock"), turn(), stamp(9, "green")].join("\n");
    const { logs } = read([say("one"), say("two")].join("\n"), runLog, { final: false });
    expect(by(logs)).toEqual(["aide-before", "ai", "aide-after"]);
    expect(logs[1]!.lines).toEqual(["one", "two"]);
  });

  test("a finished step that ran no turn is one aide part; a running one is aide-before (AC-3)", () => {
    const runLog = [stamp(0, "lock"), stamp(1, "fetching main")].join("\n");
    expect(by(read("", runLog, { final: true }).logs)).toEqual(["aide"]);
    expect(by(read("", runLog, { final: false }).logs)).toEqual(["aide-before"]);
    expect(read("", runLog, { final: true }).logs[0]!.lines).toHaveLength(2);
  });

  test("a running step has aide-before and ai, and no final message is added (AC-3)", () => {
    const transcript = [bash("a", "x"), say("almost")].join("\n") + "\n" + result("done");
    const { logs } = read(transcript, [stamp(0, "lock"), turn(0)].join("\n"), { final: false });
    expect(by(logs)).toEqual(["aide-before", "ai"]);
    expect(logs[1]!.lines).toEqual(["Bash x", "almost"]);
  });

  test("an unstamped note loses its prefix and any other line is shown as it is (AC-3)", () => {
    const runLog = ["aide-run-spec: an older note", "Worktree links: read from x", turn(0)].join("\n");
    expect(read(say("a"), runLog, { final: false }).logs[0]!.lines).toEqual(["an older note", "Worktree links: read from x"]);
  });
});

describe("stepLog: the final message", () => {
  test("only the last turn's last line is the whole message (AC-5)", () => {
    const long = `${"word ".repeat(60)}end`;
    const one = [say(long)].join("\n") + "\n";
    const two = [bash("a", "x"), say("All done.")].join("\n") + "\n" + result("All done.");
    const runLog = [turn(0), stamp(5, "red"), turn(bytes(one))].join("\n");
    const { logs } = read(one + two, runLog);
    const ai = logs.filter((p) => p.by === "ai");

    expect(ai[0]!.lines[0]!.endsWith("…")).toBe(true);
    expect(ai[1]!.lines).toEqual(["Bash x", "All done."]);
  });
});

describe("stepLog: the error lines", () => {
  test("the failed command and Aide's flagged line, in the order they happened, and nothing else (AC-7)", () => {
    const transcript = [bash("a", "bun test"), failed("a"), bash("b", "git status")].join("\n") + "\n";
    const runLog = [stamp(0, "lock"), turn(0), stamp(5, "error: the tests are red — handing them back")].join("\n");
    const { errors } = read(transcript, runLog, { final: false });

    expect(errors).toEqual(["Bash bun test", "10:45:05 +5s error: the tests are red — handing them back"]);
  });
});
