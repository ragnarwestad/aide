// What a row says when a step failed on the AI it was told to run on.
//
// A CLI's own words are the only thing the board has, and they vary from
// useful to "Unexpected server error". So the sentence around them is
// built here rather than trusted to arrive: which AI and which model the
// step was on, and the one tab that answers "is that AI actually
// usable" - the Installation tab of that AI's provider under Settings.
//
// It is the fallback. When the runner could sort the provider's own error
// (`providerError`, `core/scripts/lib/run-spec/turn/provider-error.sh`),
// the row says that in the board's own words instead
// (`cliErrorMessage`, `src/queue/runner/cross-check-message.ts`), and the
// tool's words are the detail. This sentence covers the rest: the tool's
// words as they came, and the check that can answer for itself.

import type { BoardMessage } from "../i18n/message.ts";
import { errorSentence, writtenMessage } from "./error-sentence.ts";

/** The tools whose Settings tab a reader can be sent to. Kept as a plain
 *  list rather than imported from the render layer: this module is
 *  called from the queue, which may not import `src/serve`, and the tab
 *  names are the same four the check itself knows. */
const TOOL_TABS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

/** The name of `tool`'s own tab on the Settings page, or undefined for a
 *  tool that has none. */
export const toolLabel = (tool: string | undefined): string | undefined =>
  tool ? TOOL_TABS[tool] : undefined;

/** The endings where "is this AI usable at all" is the live question.
 *  `cli-error` is the CLI itself failing rather than the work in it, and
 *  `spawn-failed` is a CLI that could not be started at all. Every other
 *  ending is about the work: a scope violation, a merge left open, a
 *  suite gone red. Naming the AI helps on all of them; sending a reader
 *  to the Installation tab helps only on these, and a suggestion that fires on
 *  everything is one nobody reads. */
const TOOL_LEVEL_ENDINGS = new Set(["cli-error", "spawn-failed"]);

/** `refused` is the runner declining before any model ran, and almost
 *  always for one of its own rules — a dependency not archived, a step
 *  not analyzed yet — which the AI's login has nothing to do with. It is
 *  about the AI only when the runner could not find the CLI, and the
 *  runner's own sentence says so by naming the binary
 *  (`core/scripts/lib/run-spec/setup/invocation.sh`). */
const refusedForTheCli = (f: ToolFailure): boolean =>
  f.terminalReason === "refused" && /\bbinary\b/.test(f.error ?? "");

export interface ToolFailure {
  /** What the CLI itself said, if anything. */
  error?: string;
  /** How the step ended, which decides whether the Installation tab is worth naming. */
  terminalReason?: string;
  /** Which CLI ran the step, when the result named one. Absent when the
   *  run was refused before it started. */
  tool?: string;
  /** The model choice the step was told to run on - the name as it
   *  appears in the picker, which is what the reader chose. */
  model?: string;
}

/** The sentence, or undefined when there is nothing to name: a failure
 *  with neither a tool nor a model is not a tool failure, and wrapping
 *  it would say less than the original. */
export function toolFailureSentence(
  f: ToolFailure,
): ReturnType<typeof errorSentence> | undefined {
  // An ending that is not about the AI keeps the step's own sentence
  // exactly as the script wrote it: "the step's own work did not reach
  // origin" is not improved by being told which model was running, and a
  // prefix on every failure is a prefix nobody reads.
  if (!TOOL_LEVEL_ENDINGS.has(f.terminalReason ?? "") && !refusedForTheCli(f))
    return undefined;
  const label = f.tool ? (TOOL_TABS[f.tool] ?? f.tool) : undefined;
  if (!label && !f.model) return undefined;

  // "OpenCode on gemini-3.1-pro", "gemini-3.1-pro", or "OpenCode" —
  // whichever of the two is known, never a placeholder for the other.
  const on = label && f.model ? `${label} on ${f.model}` : (label ?? f.model);

  const said = f.error?.trim();
  const what = said
    ? `The step failed on ${on}: ${said}`
    : `The step failed on ${on}.`;

  // The tool is named only when it is known: sending a reader to "a
  // provider" without saying which tool is worse than not sending them.
  const resolve = label
    ? `Open Settings, the Providers tab, the ${label} provider the step ran on, and open its Installation tab to see whether that AI is installed and logged in.`
    : `Open Settings, the Providers tab, the provider this model's AI runs on, and open its Installation tab to see whether it is installed and logged in.`;

  return errorSentence({ what, resolve, detail: said });
}

/** What stays behind the (?) of a sentence the board words: the result's
 *  `errorLog`, and for a result without one — a refusal the board words
 *  (`fetchFailure`, `conflict`), a deploy, or a result from a runner that did
 *  not yet send it — the runner's own words, whole. */
export function stepDetail(outcome: {
  error?: unknown;
  errorLog?: unknown;
}): string | undefined {
  if (typeof outcome.errorLog === "string" && outcome.errorLog.trim())
    return outcome.errorLog;
  return typeof outcome.error === "string" && outcome.error
    ? outcome.error
    : undefined;
}

/** What a failed step's `error` and `errorDetail` should be, decided in
 *  one place rather than inline in the runner's own transition call.
 *
 *  A board message wins outright: it already says what to do, and the
 *  result's `errorLog` survives as hover detail behind it. Otherwise the
 *  sentence above is used when there is an AI or a model to name, and
 *  the CLI's raw words only when there is neither. */
export function stepFailure<M>(
  boardMessage: M | undefined,
  outcome: {
    error?: unknown;
    errorLog?: unknown;
    errorSolution?: unknown;
    terminalReason?: string;
    tool?: string;
  },
  model: string | undefined,
): {
  error: M | BoardMessage | string | undefined;
  errorDetail: string | undefined;
} {
  const said = stepDetail(outcome);
  if (boardMessage) return { error: boardMessage, errorDetail: said };
  const named = toolFailureSentence({
    error: said,
    tool: outcome.tool === "none" ? undefined : outcome.tool,
    model,
    terminalReason: outcome.terminalReason,
  });
  if (named)
    return {
      error: writtenMessage(named.problem, named.solution),
      errorDetail: named.title,
    };
  const fix =
    typeof outcome.errorSolution === "string" && outcome.errorSolution
      ? outcome.errorSolution
      : undefined;
  if (said && fix)
    return { error: writtenMessage(said, fix), errorDetail: undefined };
  return { error: said ?? outcome.terminalReason, errorDetail: undefined };
}
