// The stand-in model answers implement's review and its verification, which
// run after every implement on a test board: given the very prompts the
// runner builds (core/scripts/lib/run-spec/turn/review-prompts.sh), it ends
// with the line the runner parses, so an implement goes on to its tests.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const HERE = import.meta.dir;
const PROMPTS = join(
  HERE,
  "../../../core/scripts/lib/run-spec/turn/review-prompts.sh",
);

/** The prompt the runner sends, built by its own function. */
function prompt(call: string): string {
  const proc = Bun.spawnSync({
    cmd: ["bash", "-c", `source "${PROMPTS}"; ${call}`],
    stdout: "pipe",
    stderr: "pipe",
  });
  return proc.stdout.toString();
}

/** What the stand-in ends that prompt with. */
function answer(text: string): { is_error: boolean; result: string } {
  const proc = Bun.spawnSync({
    cmd: ["bash", join(HERE, "claude-stub")],
    stdin: new TextEncoder().encode(text),
    stdout: "pipe",
    stderr: "pipe",
  });
  return JSON.parse(proc.stdout.toString().trim().split("\n").at(-1)!);
}

describe("the stand-in answers implement's side turns", () => {
  test("a review finds no defects", () => {
    const result = answer(
      prompt(`review_prompt /x/1-description.md abc123 origin/main "" ""`),
    );
    expect(result.is_error).toBe(false);
    expect(result.result.trim().split("\n").at(-1)).toBe(
      "review: no defects found",
    );
  });

  test("a verification keeps every defect it is given", () => {
    const result = answer(
      prompt(
        `verify_prompt /x/1-description.md abc123 origin/main $'1. one\n2. two' ""`,
      ),
    );
    expect(result.is_error).toBe(false);
    expect(result.result.trim().split("\n")).toEqual(["keep 1", "keep 2"]);
  });
});
