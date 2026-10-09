// Skill-step marks in a transcript: the lines `step_log_note` asks the
// model to write, one per step start and end. Each is a line of its own
// in the Log, and no bound on the number of lines drops one.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  AIDE_PARTS,
  NO_MODEL_TURN,
  linesWithFinalMessage,
  stepLog,
  stepMarks,
  stepPlan,
  summarizeEntries,
  summarizeStream,
  type StepMark,
} from "../../../src/queue/parse-stream";

const line = (o: unknown) => JSON.stringify(o);
const say = (text: string) => line({ type: "assistant", message: { content: [{ type: "text", text }] } });
const bash = (command: string) =>
  line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Bash", input: { command } }] } });
const result = (text: string) => line({ type: "result", subtype: "success", result: text });

const START = "--- Step 1 of 9: Read the description — started";
const DONE = "--- Step 1 of 9: Read the description — done";

describe("a mark is a line of its own", () => {
  test("a text block with two marks and prose between them gives three lines, not one", () => {
    expect(summarizeStream(say(`${START}\n\nThe description asks for two tabs.\n\n${DONE}`), { tool: "claude" })).toEqual([
      START,
      "The description asks for two tabs.",
      DONE,
    ]);
  });

  test("a mark wrapped in backticks or bold is still a mark, shown bare", () => {
    expect(summarizeStream(say(`\`${START}\`\n**${DONE}**`), { tool: "claude" })).toEqual([START, DONE]);
  });

  test("a done with a note after it, and a skipped with its reason, are marks", () => {
    const text = "--- Step 4 of 9: Check for work already begun — done (nothing to keep)\n--- Step 5 of 9: Update — skipped: nothing to update";
    expect(summarizeEntries(say(text), { tool: "claude" }).every((e) => e.mark)).toBe(true);
  });

  test("a codex agent message is split the same way", () => {
    const item = line({ type: "item.completed", item: { type: "agent_message", text: `${START}\nReading.\n${DONE}` } });
    expect(summarizeStream(item, { tool: "codex" })).toEqual([START, "Reading.", DONE]);
  });

  test("a mark from a log written before the prefix is still a mark", () => {
    expect(summarizeEntries(say("analyze · Step 1 of 9: Read the description — done"), { tool: "claude" })[0]!.mark).toBe(true);
  });

  test("prose that only mentions a step is not a mark", () => {
    expect(summarizeEntries(say("Step 6 (Create the implementation plan) first."), { tool: "claude" })[0]!.mark).toBeUndefined();
  });
});

describe("no bound drops a mark", () => {
  test("forty later lines push out older lines but not the marks among them", () => {
    const text = [say(START), bash("early"), say(DONE), ...Array.from({ length: 40 }, (_, i) => bash(`later ${i}`))].join("\n");
    const lines = summarizeStream(text, { tool: "claude", max: 3 });
    expect(lines).toEqual([START, DONE, "Bash later 37", "Bash later 38", "Bash later 39"]);
  });
});

describe("a final message holding marks", () => {
  test("its marks and prose are not repeated after the lines they already made", () => {
    const message = `--- Step 9 of 9: Confirm — started\nAnalysis written.\n--- Step 9 of 9: Confirm — done`;
    expect(linesWithFinalMessage([bash("x"), say(message), result(message)].join("\n"), { tool: "claude" })).toEqual([
      "Bash x",
      "--- Step 9 of 9: Confirm — started",
      "Analysis written.",
      "--- Step 9 of 9: Confirm — done",
    ]);
  });
});

// The format is decided twice: the prompt in bash tells the model how to
// write a mark, and the parser here reads it. Every ending the prompt
// names must come back as a mark.
describe("the prompt's own format is what the parser reads", () => {
  test("each line step_log_note asks for is a mark", () => {
    const script = readFileSync(join(import.meta.dir, "../../../../core/scripts/lib/run-spec/setup/invocation.sh"), "utf-8");
    const note = script.slice(script.indexOf('step_log_note="'), script.indexOf('"\n', script.indexOf('step_log_note="')));
    const template = note.split("\n").find((l) => l.startsWith("--- Step "))!;
    const endings = note.split("\n").filter((l) => l.startsWith("— ")).map((l) => l.replace(/ \(.*\)$/, "").replace("<why>", "no tests"));
    expect(template).toBeDefined();
    expect(endings.length).toBeGreaterThanOrEqual(3);
    const head = template.replace("Step N of X", "Step 2 of 4").replace("<title>", "GREEN").replace(/ — started$/, "");
    for (const ending of ["— started", ...endings]) {
      expect(summarizeEntries(say(`${head} ${ending}`), { tool: "claude" })[0]!.mark).toBe(true);
    }
  });
});

// What a Close or Reopen dialog lists while its job runs: the step log's
// marks read back as one entry per step, in the order each was first seen.
describe("stepMarks", () => {
  const run = (...lines: string[]) => lines.map((l, i) => `aide-run-spec 14:58:${String(10 + i).padStart(2, "0")} +${i}s ${l}`).join("\n") + "\n";
  const marksOf = (transcript: string, runLog: string, final = true) =>
    stepMarks(stepLog({ text: transcript, start: 0 }, runLog, { tool: "claude", final }).logs);
  const shown = (marks: StepMark[]) => marks.map((m) => [m.title, m.state]);

  test("a close's log gives one entry per step, in order, with its marks repeated in the final message read once (AC-1)", () => {
    const skill = [
      "--- Step 1 of 4: Run the mechanical script — started",
      "--- Step 1 of 4: Run the mechanical script — done",
      "--- Step 2 of 4: Commit & push — started",
      "--- Step 2 of 4: Commit & push — done",
      "--- Step 3 of 4: Confirm — started",
      "--- Step 3 of 4: Confirm — done",
    ];
    const transcript = [say(skill[0]!), bash("aide-close-spec"), say(`${skill[1]}\n${skill[2]}`), say(skill.slice(3).join("\n")), result(skill.join("\n"))].join("\n");
    const runLog = run(
      "--- Step Aide: preparing — started",
      "fetching main from origin",
      "--- Step Aide: preparing — done",
      "model turn started (transcript at byte 0)",
      "--- Step Aide: tests and commit — started",
      "--- Step Aide: tests and commit — done",
      "--- Step 4 of 4: Merge into main — started",
      "--- Step 4 of 4: Merge into main — done",
    );
    const marks = marksOf(transcript, runLog);
    expect(shown(marks)).toEqual([
      ["Preparing", "done"],
      ["Run the mechanical script", "done"],
      ["Commit & push", "done"],
      ["Confirm", "done"],
      ["Tests and commit", "done"],
      ["Merge into main", "done"],
    ]);
    expect(marks.map((m) => m.key)).toEqual([
      "Step Aide: preparing",
      "Step 1 of 4",
      "Step 2 of 4",
      "Step 3 of 4",
      "Step Aide: tests and commit",
      "Step 4 of 4",
    ]);
  });

  test("a reopen's log, with no transcript, gives Preparing, Tests and commit and Merge into main (AC-1)", () => {
    const runLog = run(
      "--- Step Aide: preparing — started",
      "--- Step Aide: preparing — done",
      "--- Step Aide: tests and commit — started",
      "--- Step Aide: tests and commit — done",
      "--- Step 8 of 8: Merge into main — started",
    );
    expect(shown(marksOf("", runLog, false))).toEqual([
      ["Preparing", "done"],
      ["Tests and commit", "done"],
      ["Merge into main", "running"],
    ]);
  });

  test("a step marked started and not yet ended is running (AC-2)", () => {
    expect(shown(marksOf("", run("--- Step Aide: preparing — started", "fetching main"), false))).toEqual([["Preparing", "running"]]);
  });

  test("a skipped step, a done with words after it, and a step left started before a later mark are done (AC-3)", () => {
    const text = [
      "--- Step 1 of 4: Read — started",
      "--- Step 1 of 4: Read — done (nothing to keep)",
      "--- Step 2 of 4: Update — skipped: nothing to update",
      "--- Step 3 of 4: Commit — started",
      "--- Step 4 of 4: Confirm — started",
    ].join("\n");
    expect(shown(marksOf(say(text), "", false))).toEqual([
      ["Read", "done"],
      ["Update", "done"],
      ["Commit", "done"],
      ["Confirm", "running"],
    ]);
  });

  test("a merge stopped by the landing is failed, titled by the step alone, with the landing's reason (AC-4)", () => {
    const runLog = run(
      "--- Step 4 of 4: Merge into main — started",
      "error: --- Step 4 of 4: Merge into main — stopped: nothing was merged — the close is not finished",
    );
    const [merge] = marksOf("", runLog);
    expect(merge).toEqual({
      key: "Step 4 of 4",
      title: "Merge into main",
      state: "failed",
      why: "nothing was merged — the close is not finished",
    });
  });

  test("a mark worded differently from its heading keeps the step's place as its key, the key the plan gives (AC-3)", () => {
    const [mark] = marksOf(say("--- Step 1 of 4: Move the spec into the archive — started"), "", false);
    expect(mark!.key).toBe("Step 1 of 4");
    expect(mark!.title).toBe("Move the spec into the archive");
  });
});

// What a Close or Reopen dialog lists before its job has marked anything:
// the steps the job's log WILL mark, read from the skill it runs.
describe("stepPlan", () => {
  const skillText = (steps: string[], last: "aide" | "session" = "aide") =>
    steps
      .map((title, i) => {
        const n = i + 1;
        const body = i === steps.length - 1 && last === "aide"
          ? `Aide writes \`--- Step ${n} of ${steps.length}: ${title} — started\` itself, after this session.`
          : `First write \`--- Step ${n} of ${steps.length}: ${title} — started\`.`;
        return `### Step ${n} of ${steps.length}: ${title}\n\n${body}\n`;
      })
      .join("\n");
  /** A skills folder holding `aide-<step>/SKILL.md` with `text`. */
  const skillsWith = (step: string, text: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "step-plan-"));
    mkdirSync(join(dir, `aide-${step}`));
    writeFileSync(join(dir, `aide-${step}`, "SKILL.md"), `# aide-${step}\n\n## Workflow\n\n${text}`);
    return dir;
  };

  test("a close's plan is Aide's preparing, the skill's steps, Aide's tests and commit, then the heading Aide writes (AC-1)", () => {
    const dir = skillsWith("close", skillText(["move the spec", "commit", "confirm", "merge into main"]));
    const plan = stepPlan("close", dir);
    expect(plan.map((s) => s.key)).toEqual([
      "Step Aide: preparing",
      "Step 1 of 4",
      "Step 2 of 4",
      "Step 3 of 4",
      "Step Aide: tests and commit",
      "Step 4 of 4",
    ]);
    expect(plan.map((s) => s.label)).toEqual(["Preparing", "Move the spec", "Commit", "Confirm", "Tests and commit", "Merge into main"]);
  });

  test("a step that runs no model turn lists Aide's two parts and the heading Aide writes, none of the session's (AC-1)", () => {
    const [step] = [...NO_MODEL_TURN];
    const dir = skillsWith(step!, skillText(["find the spec", "move it back", "merge into main"]));
    expect(stepPlan(step!, dir).map((s) => s.key)).toEqual(["Step Aide: preparing", "Step Aide: tests and commit", "Step 3 of 3"]);
  });

  test("the checkout's own skills are found: Close's and Reopen's plans start with preparing and end on a numbered step (AC-1)", () => {
    for (const step of ["close", "reopen"]) {
      const keys = stepPlan(step).map((s) => s.key);
      expect(keys.length).toBeGreaterThan(2);
      expect(keys[0]).toBe("Step Aide: preparing");
      expect(keys.at(-1)).toMatch(/^Step \d+ of \d+$/);
    }
  });

  test("a skill rewritten with another heading and a later modification time is read again (AC-1)", () => {
    const dir = skillsWith("close", skillText(["one", "two"]));
    const file = join(dir, "aide-close", "SKILL.md");
    expect(stepPlan("close", dir).map((s) => s.key)).toContain("Step 2 of 2");
    writeFileSync(file, skillText(["one", "two", "three"]));
    const later = new Date(statSync(file).mtimeMs + 5000);
    utimesSync(file, later, later);
    expect(stepPlan("close", dir).map((s) => s.key)).toContain("Step 3 of 3");
  });

  test("a file unchanged since it was read is not read again (AC-1)", () => {
    const dir = skillsWith("close", skillText(["one", "two"]));
    const file = join(dir, "aide-close", "SKILL.md");
    utimesSync(file, 1_000_000, 1_000_000);
    const first = stepPlan("close", dir);
    writeFileSync(file, skillText(["uno", "dos", "tres"]));
    utimesSync(file, 1_000_000, 1_000_000);
    expect(stepPlan("close", dir)).toEqual(first);
  });

  test("the pair the runner decides in bash is the pair stepPlan holds (AC-1)", () => {
    const scripts = join(import.meta.dir, "../../../../core/scripts");
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
    const sources = ["aide-run-spec", ...files(join(scripts, "lib")).map((f) => f.slice(scripts.length + 1))].map((f) =>
      readFileSync(join(scripts, f), "utf-8"),
    );
    // The literals `aide_part_open "<name>"` is called with; `"$variable"` names a variable and does not count.
    const names = sources.flatMap((text) => [...text.matchAll(/^\s*(?:[^#\n]*&&\s*)?aide_part_open "([^"$]+)"/gm)].map((m) => m[1]!));
    expect(names.sort()).toEqual([AIDE_PARTS.before, AIDE_PARTS.after].sort());

    const paths = readFileSync(join(scripts, "lib/run-spec/turn/spec-paths.sh"), "utf-8");
    const stretch = paths.slice(paths.indexOf('create_no_ai=""'), paths.indexOf('if [ -n "$skip_ai" ]'));
    const noModel = [...stretch.matchAll(/\[ "\$command_name" = "(\w+)" \]\s*;\s*then/g)].map((m) => m[1]!);
    expect(new Set(noModel)).toEqual(new Set(NO_MODEL_TURN));
  });

  test("a skills folder with no file for the step, or a file with no Step N of X heading, gives no plan (AC-4)", () => {
    const empty = mkdtempSync(join(tmpdir(), "step-plan-"));
    expect(stepPlan("close", empty)).toEqual([]);
    expect(stepPlan("close", skillsWith("close", "No steps here.\n"))).toEqual([]);
  });
});
