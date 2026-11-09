import type { runScript } from "../land-branch/run-script.ts";
import { CHECK_TIMEOUT_MS, stripAnsi } from "../tool-readers/run.ts";
import type { OfferedModel, ToolModels } from "../../render";

export async function readOpencodeModels(
  run: typeof runScript,
  bin: string,
  base: Pick<ToolModels, "tool" | "at">,
): Promise<ToolModels> {
  const result = await run([bin, "models"], process.cwd(), CHECK_TIMEOUT_MS);
  if (result.timedOut) return { ...base, offered: [], error: "opencode models did not finish in time." };
  if (result.code !== 0) return { ...base, offered: [], error: "opencode models could not be run." };
  const offered: OfferedModel[] = stripAnsi(result.stdout).split("\n").map((line) => line.trim())
    .filter((line) => /^\S+\/\S+$/.test(line)).map((model) => ({ model }));
  return { ...base, offered };
}
