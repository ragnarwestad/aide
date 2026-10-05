// The approaches a ticked spec's analysis marks in 3-solution.md, the
// chosen line the board writes there, and whether a choice is waiting.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseApproaches, pendingChoice, withChosenApproach } from "../../src/project/approach-choice.ts";
import { chooseApproachIn } from "../../src/project/discover";

const REPO = join(import.meta.dir, "..", "..", "..");

const solution = (approaches: string): string =>
  [
    "# A spec - Solution",
    "",
    "## Scope",
    "",
    "Files.",
    "",
    "---",
    "",
    "## Approaches",
    "",
    approaches,
    "",
    "### Recommended: Approach A",
    "",
    "Why A.",
    "",
    "---",
    "",
    "## Recommended solution",
    "",
    "**Approach Z: Not a lead, outside Approaches (real alternative).** text",
    "",
  ].join("\n");

const THREE = [
  "**Approach A: Hold the chained implement (recommended).** The opt-in is a box.",
  "- **Pros:** reuses the hold",
  "- **Cons:** none",
  "",
  "**Approach B: End the job after analyze, the way an archive",
  "ends (real alternative).** The tick ends it.",
  "- **Pros:** nothing queued",
  "",
  "**Approach C: Hold every implement (considered and rejected).** Same as A.",
].join("\n");

describe("parseApproaches", () => {
  test("reads each lead's letter, title and mark, a lead wrapped over two lines too (AC-2)", () => {
    expect(parseApproaches(solution(THREE))).toEqual({
      approaches: [
        { letter: "A", title: "Hold the chained implement", mark: "recommended" },
        { letter: "B", title: "End the job after analyze, the way an archive ends", mark: "real alternative" },
        { letter: "C", title: "Hold every implement", mark: "considered and rejected" },
      ],
    });
  });

  test("a lead with no mark, as an unticked spec writes it, is not an approach to offer (AC-9)", () => {
    const parsed = parseApproaches(solution("**Approach A: One (recommended).** x\n\n**Approach B: Two.** y"));
    expect(parsed.approaches.map((a) => a.letter)).toEqual(["A"]);
  });

  test("reads the chosen line (AC-7)", () => {
    expect(parseApproaches(solution(`**Chosen approach:** Approach B\n\n${THREE}`)).chosen).toBe("B");
  });

  test("reads only the newest round (AC-7)", () => {
    const text =
      solution(`**Chosen approach:** Approach B\n\n${THREE}`) +
      "\n## Round 2\n\n### Approaches\n\n" +
      "**Approach A: Again (recommended).** x\n\n**Approach B: Other (real alternative).** y\n";
    expect(parseApproaches(text)).toEqual({
      approaches: [
        { letter: "A", title: "Again", mark: "recommended" },
        { letter: "B", title: "Other", mark: "real alternative" },
      ],
    });
  });

  test("ignores a lead inside a code block", () => {
    expect(parseApproaches(solution("```markdown\n**Approach A: Example (recommended).** x\n```")).approaches).toEqual([]);
  });

  test("the marked leads the spec-structure rule shows parse as the rule says (AC-2)", () => {
    const rule = readFileSync(join(REPO, "core", "rules", "spec-structure.md"), "utf-8");
    const block = rule.split(/^[ \t]*```/m).find((part) => part.includes("(real alternative)"));
    expect(block).toBeDefined();
    const example = block!.replace(/^markdown\n/, "").replace(/^[ \t]+/gm, "");
    const parsed = parseApproaches(`## Approaches\n\n${example}`);
    expect(parsed.approaches.map((a) => [a.letter, a.mark])).toEqual([
      ["A", "recommended"],
      ["B", "real alternative"],
      ["C", "considered and rejected"],
    ]);
    expect(parsed.chosen).toBe("B");
  });
});

describe("pendingChoice", () => {
  test("two or more real alternatives and no choice: each by letter and title, the recommended one marked, no rejected one (AC-3)", () => {
    expect(pendingChoice(true, parseApproaches(solution(THREE)))).toEqual([
      { letter: "A", title: "Hold the chained implement", mark: "recommended" },
      { letter: "B", title: "End the job after analyze, the way an archive ends", mark: "real alternative" },
    ]);
  });

  test("one real alternative is no choice (AC-4)", () => {
    const one = "**Approach A: One (recommended).** x\n\n**Approach B: Two (considered and rejected).** y";
    expect(pendingChoice(true, parseApproaches(solution(one)))).toBeNull();
  });

  test("none marked is no choice (AC-4)", () => {
    expect(pendingChoice(true, parseApproaches(solution("**Approach A: One.** x\n\n**Approach B: Two.** y")))).toBeNull();
  });

  test("a chosen approach recorded in the newest round ends the choice (AC-7)", () => {
    expect(pendingChoice(true, parseApproaches(solution(`**Chosen approach:** Approach A\n\n${THREE}`)))).toBeNull();
  });

  test("a choice recorded only in an earlier round does not answer the new round (AC-7)", () => {
    const text =
      solution(`**Chosen approach:** Approach B\n\n${THREE}`) +
      "\n## Round 2\n\n### Approaches\n\n" +
      "**Approach A: Again (recommended).** x\n\n**Approach B: Other (real alternative).** y\n";
    expect(pendingChoice(true, parseApproaches(text))?.map((a) => a.letter)).toEqual(["A", "B"]);
  });

  test("a spec that did not ask to choose has no choice, marks or not (AC-9)", () => {
    expect(pendingChoice(false, parseApproaches(solution(THREE)))).toBeNull();
  });
});

describe("withChosenApproach", () => {
  test("writes the chosen line as its own paragraph directly under Approaches, which reads back (AC-5)", () => {
    const written = withChosenApproach(solution(THREE), "B");
    expect(written).toContain("## Approaches\n\n**Chosen approach:** Approach B\n\n**Approach A:");
    expect(parseApproaches(written).chosen).toBe("B");
    expect(parseApproaches(written).approaches).toHaveLength(3);
  });

  test("replaces a chosen line already there, never adds a second (AC-6)", () => {
    const written = withChosenApproach(withChosenApproach(solution(THREE), "B"), "A");
    expect(written.match(/\*\*Chosen approach:\*\*/g)).toHaveLength(1);
    expect(parseApproaches(written).chosen).toBe("A");
  });

  test("writes into the newest round's Approaches (AC-7)", () => {
    const text = solution(THREE) + "\n## Round 2\n\n### Approaches\n\n**Approach A: Again (recommended).** x\n";
    const written = withChosenApproach(text, "A");
    expect(written).toContain("### Approaches\n\n**Chosen approach:** Approach A\n\n**Approach A: Again");
    expect(written.indexOf("**Chosen approach:**")).toBeGreaterThan(written.indexOf("## Round 2"));
  });
});

// --- the description's line, read the way aide-run-spec reads it ------------

const CASES = JSON.parse(readFileSync(join(REPO, "core", "tests", "fixtures", "choose-approach-line.json"), "utf-8")).cases as {
  name: string;
  description: string | null;
  chosen: "yes" | "no";
}[];

describe("chooseApproachIn", () => {
  test.each(CASES.map((c) => [c.name, c] as const))("%s (AC-9, AC-10)", (_name, c) => {
    const text =
      "# A spec - Description\n\n## Tracking info\n\n- **Created:** `2026-10-03 07:00 UTC`\n" +
      (c.description === null ? "" : `- **Let me choose the approach:** ${c.description}\n`) +
      "\n---\n\n## Description\n\nText.\n";
    expect(chooseApproachIn(text)).toBe(c.chosen === "yes");
  });
});
