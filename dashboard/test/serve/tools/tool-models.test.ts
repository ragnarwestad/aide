// What a press of Check reads of an AI's models. Claude is asked one model
// at a time through `/model`, which runs none; only the four families and
// the configured full ids are asked, since Claude Code names every other
// name it accepts as well. Codex and OpenCode list theirs.

import { describe, expect, test } from "bun:test";
import { askClaudeModel, readModels } from "../../../src/serve/tool-models";

type RunResult = { code: number; stdout: string; stderr: string; timedOut: boolean };
type Run = typeof import("../../../src/serve/land-branch/run-script.ts").runScript;

const AT = new Date("2026-10-03T13:30:00.000Z");

/** A stand-in for `runScript` that answers each command through `answer`. */
function fakeRun(answer: (argv: string[]) => Partial<RunResult>) {
  const calls: string[][] = [];
  const run = async (argv: string[]): Promise<RunResult> => {
    calls.push(argv);
    return { code: 0, stdout: "", stderr: "", timedOut: false, ...answer(argv) };
  };
  return Object.assign(run as never as Run, { calls });
}

const opts = (run: Run, configured: string[] = []) => ({
  run,
  configured,
  scriptPath: (name: string) => name,
  now: () => AT,
});

/** What `claude -p --model <m> "/model" --output-format stream-json
 *  --verbose` prints, as Claude Code 2.1.288 printed it on 2026-10-03:
 *  hook events first, then the init event naming the id the model
 *  resolves to, then the result carrying the `/model` text. */
function claudeStream(id: string, shown: string): string {
  return [
    JSON.stringify({ type: "system", subtype: "hook_started", hook_name: "SessionStart:startup" }),
    JSON.stringify({ type: "system", subtype: "hook_response", hook_name: "SessionStart:startup", output: "" }),
    JSON.stringify({ type: "system", subtype: "init", cwd: "/tmp", session_id: "s1", model: id, tools: [] }),
    JSON.stringify({
      type: "result", subtype: "success", is_error: false, num_turns: 0, total_cost_usd: 0,
      result: `Current model: \`${shown}\`\n\nRun /model to change it.`,
    }),
    "",
  ].join("\n");
}

/** Claude Code as it answered on this host: the four families, one fixed
 *  version, and the asked string echoed for anything it does not know. */
const KNOWN: Record<string, [string, string]> = {
  opus: ["claude-opus-5-5", "Opus 5.5"],
  sonnet: ["claude-sonnet-5-5", "Sonnet 5.5"],
  fable: ["claude-fable-5-1", "Fable 5.1"],
  haiku: ["claude-haiku-4-5-20251001", "Haiku 4.5"],
  "claude-opus-4-8": ["claude-opus-4-8", "Opus 4.8"],
  "opus[1m]": ["claude-opus-5-5[1m]", "Opus 5.5 (1M context)"],
  opusplan: ["claude-sonnet-5-5", "Opus in plan mode, else Sonnet"],
};
const claudeAnswers = (argv: string[]): Partial<RunResult> => {
  const asked = argv[argv.indexOf("--model") + 1]!;
  const known = KNOWN[asked];
  return { stdout: known ? claudeStream(known[0], known[1]) : claudeStream(asked, asked) };
};

describe("asking Claude Code to name one model", () => {
  test("the name is read from the result and the id from the init event, after hook events (AC-3)", async () => {
    const run = fakeRun(() => ({ stdout: claudeStream("claude-fable-5-1", "Fable 5.1") }));
    expect(await askClaudeModel(run, "claude", "fable")).toEqual({ known: true, name: "Fable 5.1", id: "claude-fable-5-1" });
  });

  test("an effort written after the name is left out of it (AC-3)", async () => {
    const stdout = claudeStream("claude-fable-5-1", "Fable 5.1").replace("`Fable 5.1`", "`Fable 5.1` (effort: medium)");
    const run = fakeRun(() => ({ stdout }));
    expect(await askClaudeModel(run, "claude", "fable")).toMatchObject({ known: true, name: "Fable 5.1" });
  });

  test("it is asked with -p --model <m> /model, which runs no model (AC-3)", async () => {
    const run = fakeRun(claudeAnswers);
    await askClaudeModel(run, "claude", "opus");
    expect(run.calls).toEqual([[
      "claude", "-p", "--model", "opus", "/model",
      "--no-session-persistence", "--output-format", "stream-json", "--verbose",
    ]]);
  });

  test("an id answered with the id itself is one Claude Code does not know (AC-5)", async () => {
    const run = fakeRun(claudeAnswers);
    expect(await askClaudeModel(run, "claude", "claude-opus-9-9")).toEqual({ known: false });
  });

  test("an answer with no Current model line is an error, not a name (AC-3)", async () => {
    const run = fakeRun(() => ({ stdout: JSON.stringify({ type: "result", result: "Not logged in" }) }));
    expect(await askClaudeModel(run, "claude", "opus")).toMatchObject({ error: expect.any(String) });
  });

  test("a run that does not end in time is an error (AC-3)", async () => {
    const run = fakeRun(() => ({ timedOut: true }));
    expect(await askClaudeModel(run, "claude", "opus")).toMatchObject({ error: expect.any(String) });
  });
});

describe("Claude's models", () => {
  test("the four families are asked, side by side, and offered with their names and ids (AC-3)", async () => {
    const run = fakeRun(claudeAnswers);
    const reading = await readModels("claude", opts(run));
    expect(run.calls.map((argv) => argv[3]).sort()).toEqual(["fable", "haiku", "opus", "sonnet"]);
    expect(reading).toEqual({
      tool: "claude",
      at: AT.toISOString(),
      offered: [
        { model: "opus", name: "Opus 5.5", id: "claude-opus-5-5" },
        { model: "sonnet", name: "Sonnet 5.5", id: "claude-sonnet-5-5" },
        { model: "fable", name: "Fable 5.1", id: "claude-fable-5-1" },
        { model: "haiku", name: "Haiku 4.5", id: "claude-haiku-4-5-20251001" },
      ],
    });
  });

  test("a configured full id is asked too, and offered when Claude Code names it (AC-3, AC-4)", async () => {
    const run = fakeRun(claudeAnswers);
    const configured = ["opus", "Sonnet", "claude-opus-4-8", "claude-opus-9-9"];
    const reading = await readModels("claude", opts(run, configured));
    expect(run.calls.map((argv) => argv[3]).sort()).toEqual(
      ["claude-opus-4-8", "claude-opus-9-9", "fable", "haiku", "opus", "sonnet"],
    );
    expect(reading.offered.map((m) => m.model)).toEqual(["opus", "sonnet", "fable", "haiku", "claude-opus-4-8"]);
    expect(reading.offered.find((m) => m.model === "claude-opus-4-8")).toEqual(
      { model: "claude-opus-4-8", name: "Opus 4.8", id: "claude-opus-4-8" },
    );
  });

  test("any other configured name is asked for its version, and never offered (AC-3, AC-6)", async () => {
    const run = fakeRun(claudeAnswers);
    const reading = await readModels("claude", opts(run, ["opusplan", "opus[1m]"]));
    expect(run.calls.map((argv) => argv[3])).toContain("opus[1m]");
    expect(reading.offered.map((m) => m.model)).toEqual(["opus", "sonnet", "fable", "haiku"]);
    expect(reading.named).toEqual([
      { model: "opusplan", name: "Opus in plan mode, else Sonnet", id: "claude-sonnet-5-5" },
      { model: "opus[1m]", name: "Opus 5.5 (1M context)", id: "claude-opus-5-5[1m]" },
    ]);
  });

  test("one ask that fails makes the whole reading an error (AC-3)", async () => {
    const run = fakeRun((argv) => (argv[3] === "haiku" ? { timedOut: true } : claudeAnswers(argv)));
    const reading = await readModels("claude", opts(run));
    expect(reading.error).toBeTruthy();
    expect(reading.offered).toEqual([]);
  });

  test("a CLI that cannot be started is a reading that failed, not a throw (AC-3)", async () => {
    const run = (async () => { throw new Error("ENOENT: claude"); }) as never as Run;
    const reading = await readModels("claude", opts(run));
    expect(reading.error).toContain("ENOENT");
  });
});

/** `codex debug models` as codex-cli 0.160.0 printed it, cut to three. */
const CODEX_MODELS = JSON.stringify({
  models: [
    { slug: "gpt-6.1-sol", display_name: "GPT-6.1-Sol", visibility: "list", description: "x" },
    { slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list" },
    { slug: "gpt-reserve", display_name: "GPT Reserve", visibility: "hide" },
  ],
});

describe("Codex's models", () => {
  test("are read from codex debug models, leaving out the hidden ones (AC-7)", async () => {
    const run = fakeRun(() => ({ stdout: CODEX_MODELS }));
    const reading = await readModels("codex", opts(run));
    expect(run.calls).toEqual([["codex", "debug", "models"]]);
    expect(reading.offered).toEqual([
      { model: "gpt-6.1-sol", name: "GPT-6.1-Sol" },
      { model: "gpt-5.5", name: "GPT-5.5" },
    ]);
    expect(reading.error).toBeUndefined();
  });

  test("an answer of another shape is a reading that failed, never an empty list (AC-7)", async () => {
    for (const stdout of ["not json", JSON.stringify({ data: [] }), JSON.stringify({ models: [{ id: "x" }] })]) {
      const reading = await readModels("codex", opts(fakeRun(() => ({ stdout }))));
      expect(reading.error).toBeTruthy();
    }
  });
});

describe("OpenCode's models", () => {
  test("are read from opencode models, one provider/model a line (AC-10)", async () => {
    const run = fakeRun(() => ({ stdout: "opencode/gemini-3.1-pro\nopencode/glm-5\n\n" }));
    const reading = await readModels("opencode", opts(run));
    expect(run.calls).toEqual([["opencode", "models"]]);
    expect(reading.offered).toEqual([{ model: "opencode/gemini-3.1-pro" }, { model: "opencode/glm-5" }]);
  });

  test("a run that fails is a reading that failed (AC-10)", async () => {
    const reading = await readModels("opencode", opts(fakeRun(() => ({ code: 1, stderr: "boom" }))));
    expect(reading.error).toBeTruthy();
  });
});

describe("Copilot's models", () => {
  test("are not read: its command line cannot list them (AC-1)", async () => {
    const run = fakeRun(() => ({}));
    const reading = await readModels("copilot", opts(run));
    expect(reading).toMatchObject({ tool: "copilot", offered: [], noSource: true });
    expect(run.calls).toEqual([]);
  });
});
