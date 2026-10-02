// Claude Code's usage, read from what `claude -p /usage` prints. The
// command answers from the account and runs no model (0 turns, $0,
// checked 2026-10-02 on Claude Code 2.1.288). Its text is for a
// terminal, not a contract, so what cannot be read as windows is kept as
// the tool printed it rather than guessed at.

import type { runScript } from "../land-branch/run-script.ts";
import { CHECK_TIMEOUT_MS, stripAnsi } from "../tool-check.ts";
import type { ToolUsage, UsageWindow } from "../../render";

/** `--no-session-persistence` keeps each press from leaving a session
 *  transcript behind; the text is the same without it. */
export const CLAUDE_USAGE_ARGS = ["-p", "/usage", "--no-session-persistence"];

/** `<label>: <n>% used`, from the start of the line, then optionally
 *  `· resets <when>`. Lines further down ("67% of your usage came from
 *  …", "Top skills: …") do not start that way and are not windows. */
const WINDOW_LINE = /^([^:\s][^:]*):\s*(\d+(?:\.\d+)?)%\s+used(?:\s*·\s*resets\s+(.+?))?\s*$/;

export function parseClaudeUsage(text: string): UsageWindow[] {
  const windows: UsageWindow[] = [];
  for (const line of stripAnsi(text).split("\n")) {
    const match = WINDOW_LINE.exec(line);
    if (!match) continue;
    windows.push({
      name: match[1]!.trim(),
      usedPercent: Number(match[2]),
      ...(match[3] ? { resets: match[3] } : {}),
    });
  }
  return windows;
}

/** One or more window lines are the windows; anything else printed is
 *  shown as it came, whatever the exit code (a "not logged in" too);
 *  nothing printed, or no end in time, is a reading that failed. */
export async function readClaudeUsage(
  run: typeof runScript,
  bin: string,
  base: Pick<ToolUsage, "tool" | "at">,
): Promise<ToolUsage> {
  const command = [bin, ...CLAUDE_USAGE_ARGS];
  const result = await run(command, process.cwd(), CHECK_TIMEOUT_MS);
  const shown = `claude ${CLAUDE_USAGE_ARGS.join(" ")}`;
  if (result.timedOut) return { ...base, windows: [], error: `${shown} did not finish in time.` };
  const windows = parseClaudeUsage(result.stdout);
  if (windows.length > 0) return { ...base, windows };
  const text = stripAnsi([result.stdout, result.stderr].filter((t) => t.trim()).join("\n")).replace(/^\n+|\s+$/g, "");
  if (text) return { ...base, windows: [], text };
  return { ...base, windows: [], error: `${shown} printed nothing.` };
}
