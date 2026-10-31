// The round's board carries one scheduled job, and it fails: its entry in
// the queue config `run` writes, its prompt in the fixture project, and the
// stand-in model ending that prompt with an error. Together they put a
// failed scheduled job's row on the Running tab of every test board.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dir;
const RUN = readFileSync(join(HERE, "run"), "utf8");

/** The queue config `run` writes, read out of its heredoc. */
function roundConfig(): Record<string, any> {
  const body = RUN.match(/cat > "\$WORK\/queue-config\.json" <<CFG\n([\s\S]*?)\nCFG\n/)?.[1];
  if (!body) throw new Error("no queue-config heredoc in run");
  return JSON.parse(body);
}

describe("the round's scheduled job that fails", () => {
  test("the board's config has one entry, on the stand-in model, whose prompt the fixture project holds", () => {
    const config = roundConfig();
    const entries = config.schedules?.["aide-test"] ?? [];
    expect(entries.map((e: { name: string }) => e.name)).toEqual(["a-job-that-fails"]);
    expect(config.model.schedule).toBe("script");
    expect(existsSync(join(HERE, "fixture-project", entries[0].prompt))).toBe(true);
  });

  test("the stand-in ends that prompt with an error", () => {
    const entry = roundConfig().schedules["aide-test"][0];
    const prompt = readFileSync(join(HERE, "fixture-project", entry.prompt), "utf8");
    const proc = Bun.spawnSync({
      cmd: ["bash", join(HERE, "claude-stub")],
      stdin: new TextEncoder().encode(`${prompt}\nSplit this work into a few steps.\n`),
      stdout: "pipe",
      stderr: "pipe",
    });
    const lines = proc.stdout.toString().trim().split("\n");
    const result = JSON.parse(lines.at(-1)!);
    expect(result.type).toBe("result");
    expect(result.is_error).toBe(true);
    expect(result.result).toContain("on purpose");
  });
});
