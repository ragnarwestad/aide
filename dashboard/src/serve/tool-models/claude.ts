// Claude Code's models, asked one at a time with `/model`, which answers
// from Claude Code itself and runs no model (0 turns, $0, checked
// 2026-10-03 on Claude Code 2.1.288). The stream's init event names the id
// the model resolves to; the result's text names it as Claude Code shows
// it, and an unknown model is answered with the asked string itself.

import type { runScript } from "../land-branch/run-script.ts";
import { events } from "../../queue/parse-stream/shared.ts";
import { CHECK_TIMEOUT_MS, stripAnsi } from "../tool-check.ts";
import type { OfferedModel, ToolModels } from "../../render";

/** The four families offered. Every other name Claude Code takes
 *  (`best`, `default`, `opusplan`, the `[1m]` names) is not a model of its
 *  own, and is never asked, since Claude Code would name it too. */
export const CLAUDE_FAMILIES = ["opus", "sonnet", "fable", "haiku"] as const;

/** A full Claude model id, such as `claude-opus-4-8`. */
export const CLAUDE_ID = /^claude-[a-z0-9-]{1,57}$/;

export const isClaudeFamily = (model: string): boolean =>
  (CLAUDE_FAMILIES as readonly string[]).includes(model.toLowerCase());

/** The model goes after `--model`. `--no-session-persistence` keeps each
 *  press from leaving a session behind; the stream is what carries the
 *  id. */
export const claudeModelArgs = (model: string): string[] => [
  "-p", "--model", model, "/model", "--no-session-persistence", "--output-format", "stream-json", "--verbose",
];

/** What Claude Code said of one model: its name and the id it resolves
 *  to, that it does not know it, or that it could not be asked. */
export type ClaudeModelAnswer = { known: true; name: string; id?: string } | { known: false } | { error: string };

/** The back-quoted text after `Current model:` on its own line, an effort
 *  written after it left out. */
const CURRENT = /^Current model:\s*`([^`]+)`/m;

export function parseClaudeModel(asked: string, stdout: string): ClaudeModelAnswer | undefined {
  let id: string | undefined;
  let name: string | undefined;
  for (const event of events(stdout)) {
    if (event.type === "system" && event.subtype === "init" && typeof event.model === "string") id = event.model;
    if (event.type === "result" && typeof event.result === "string") {
      name = CURRENT.exec(stripAnsi(event.result))?.[1]?.trim();
    }
  }
  if (!name) return undefined;
  if (name.toLowerCase() === asked.toLowerCase()) return { known: false };
  return { known: true, name, ...(id ? { id } : {}) };
}

/** Asks Claude Code to name `model`. Never throws for an answer it cannot
 *  read: that is an error answer, said in a sentence. */
export async function askClaudeModel(run: typeof runScript, bin: string, model: string): Promise<ClaudeModelAnswer> {
  const shown = `claude -p --model ${model} /model`;
  const result = await run([bin, ...claudeModelArgs(model)], process.cwd(), CHECK_TIMEOUT_MS);
  if (result.timedOut) return { error: `${shown} did not finish in time.` };
  return parseClaudeModel(model, result.stdout) ?? { error: `${shown} printed no Current model line.` };
}

/** The four families, and every configured Claude model, asked side by
 *  side. The families and each configured full id Claude Code names are
 *  offered; a configured full id it does not know is left out, so the tab
 *  lists it as no longer offered. Any other configured name (`opusplan`,
 *  `best`, the `[1m]` names) is asked only for the name and id its choice
 *  shows, and kept apart in `named`: it is not a model of its own and is
 *  never offered. Any ask that fails makes the whole reading one that
 *  failed. */
export async function readClaudeModels(
  run: typeof runScript,
  bin: string,
  configured: string[],
  base: Pick<ToolModels, "tool" | "at">,
): Promise<ToolModels> {
  const asked: string[] = [...CLAUDE_FAMILIES];
  for (const model of configured) {
    if (model && !asked.some((a) => a.toLowerCase() === model.toLowerCase())) asked.push(model);
  }
  const answers = await Promise.all(asked.map((model) => askClaudeModel(run, bin, model)));
  const failed = answers.find((a): a is { error: string } => "error" in a);
  if (failed) return { ...base, offered: [], error: failed.error };
  const offered: OfferedModel[] = [];
  const named: OfferedModel[] = [];
  answers.forEach((answer, i) => {
    if (!("known" in answer) || !answer.known) return;
    const model = asked[i]!;
    const entry = { model, name: answer.name, ...(answer.id ? { id: answer.id } : {}) };
    (isClaudeFamily(model) || CLAUDE_ID.test(model) ? offered : named).push(entry);
  });
  return { ...base, offered, ...(named.length ? { named } : {}) };
}
