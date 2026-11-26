// The last answer each AI's Installation tab gave, and what it found wanting -
// process-lifetime state read by the Settings page and by the header
// notice directly, on `pending-restart.ts`'s precedent, rather than
// threaded through `pageShell()`'s call sites. `serve/tool-check.ts` is
// the one writer.
//
// It lives HERE rather than beside the code that obtains a check because
// `src/render` may not import `src/serve` (the layering guard in
// `test/guards`), and both readers are in render.
//
// Deliberately not persisted: a check is a measurement of this machine
// at one moment, and a restart is exactly the kind of event that can
// invalidate it.

import {
  OTHER_ACCOUNT_PROBLEM, OTHER_ACCOUNT_REMOVAL, TOOL_TAB_LABELS, type CheckableTool, type ToolCheck,
} from "../pages/settings-page/tools.ts";
import { modelLists, sameModel, type ToolModels } from "../pages/settings-page/models.ts";
import type { ModelChoice } from "../../queue/types.ts";
import type { BoardMessage } from "../../messages/types.ts";
import { providerLoginCommand } from "../../queue/providers/login-command.ts";
import { UNANSWERED_MINUTES, unansweredLongEnough } from "./faults/unanswered.ts";

const LAST: Map<CheckableTool, ToolCheck> = new Map();

/** Since when (ms) each tool's checks have not finished, for as long as
 *  none has: a check the machine was too busy to finish is no answer. */
const UNANSWERED: Map<CheckableTool, number> = new Map();

/** The last reading of each tool's models, kept apart for the same
 *  reason as the usage: only a provider's Models tab reads them. */
const MODELS: Map<CheckableTool, ToolModels> = new Map();

/** Which tools a run can use — the ones a model is configured for. Read
 *  live, since the configuration can change while the board runs. Unset,
 *  every tool counts. */
let configured: (() => CheckableTool[]) | undefined;

export function setConfiguredTools(source: () => CheckableTool[]): void {
  configured = source;
}

/** The model choices as they are now, read live each time the notice is
 *  drawn: a Remove on the Models tab changes them with no new reading. */
let choices: (() => Record<string, ModelChoice> | undefined) | undefined;

export function setModelChoices(source: () => Record<string, ModelChoice> | undefined): void {
  choices = source;
}

/** A finished check replaces the last answer. One that did not finish
 *  keeps it, and starts the time the header counts before it says so. */
export function recordCheck(check: ToolCheck): void {
  if (check.unfinished) {
    if (!UNANSWERED.has(check.tool)) UNANSWERED.set(check.tool, Date.parse(check.at) || Date.now());
    return;
  }
  UNANSWERED.delete(check.tool);
  LAST.set(check.tool, check);
}

export function lastChecks(): Partial<Record<CheckableTool, ToolCheck>> {
  return Object.fromEntries(LAST) as Partial<Record<CheckableTool, ToolCheck>>;
}

export function recordModels(models: ToolModels): void {
  MODELS.set(models.tool, models);
}

export function lastModels(): Partial<Record<CheckableTool, ToolModels>> {
  return Object.fromEntries(MODELS) as Partial<Record<CheckableTool, ToolModels>>;
}

/** Test seam: a suite that records a check must not leak it into the
 *  next file's expectations. */
export function forgetChecks(): void {
  LAST.clear();
  UNANSWERED.clear();
  MODELS.clear();
  configured = undefined;
  choices = undefined;
}

/** Which tools this server has found something wrong with, as the header
 *  notice needs it: one message per thing wrong, each with its own fix. A
 *  question nobody could ASK is not a fault - the page says so, and a
 *  banner that fired on it would be on permanently. Nor is a check that
 *  did not finish, until it has gone unanswered for `UNANSWERED_FOR_MS`. */
export function toolsWithFaults(now: number = Date.now()): { tool: CheckableTool; faults: BoardMessage[] }[] {
  // A tool no model is configured for is never run, so its login is not
  // what stands between a reader and a working run.
  const usable = configured ? new Set(configured()) : undefined;
  const tools = new Set<CheckableTool>([...LAST.keys(), ...UNANSWERED.keys()]);
  const out: { tool: CheckableTool; faults: BoardMessage[] }[] = [];
  for (const tool of tools) {
    if (usable && !usable.has(tool)) continue;
    const since = UNANSWERED.get(tool);
    const faults = since !== undefined && unansweredLongEnough(since, now)
      ? [{ key: "tools.unanswered", values: { tool: TOOL_TAB_LABELS[tool], minutes: UNANSWERED_MINUTES } } as BoardMessage]
      : checkFaults(LAST.get(tool));
    if (faults.length > 0) out.push({ tool, faults });
  }
  return out;
}

/** What one finished check found wrong. Every question that comes back
 *  "no" is the login's: not logged in, with the command that logs it in,
 *  or a stored login of another account, with the command that removes it. */
function checkFaults(check: ToolCheck | undefined): BoardMessage[] {
  if (!check) return [];
  const tool = TOOL_TAB_LABELS[check.tool];
  if (check.error) {
    return [{ key: "tools.unreadable", values: { tool, said: check.error, command: `aide-preflight --facts ${check.tool}` } }];
  }
  if (!check.found) return [{ key: "tools.notInstalled", values: { tool } }];
  return check.extra.filter((entry) => entry.ok === false).map((entry): BoardMessage => {
    const who = entry.provider ?? tool;
    if (entry.problem === OTHER_ACCOUNT_PROBLEM) return { key: "tools.otherAccount", values: { who, command: OTHER_ACCOUNT_REMOVAL } };
    const command = entry.answer?.values?.command;
    return {
      key: "tools.notLoggedIn",
      values: { who, command: typeof command === "string" ? command : providerLoginCommand({ tool: check.tool }) },
    };
  });
}

/** Each AI whose configured models its last Models reading no longer
 *  offers. A reading that failed, an AI the board cannot ask, and an AI
 *  with no reading since the board started name nothing. A Claude name
 *  Claude Code answered for (`opus[1m]`, `opusplan`) is a model it knows. */
export function toolsMissingModels(): { tool: CheckableTool; models: string[] }[] {
  const live = choices?.();
  const out: { tool: CheckableTool; models: string[] }[] = [];
  for (const reading of MODELS.values()) {
    if (reading.error) continue;
    const named = reading.named ?? [];
    const gone = modelLists(reading.tool, live, reading).gone
      .filter((c) => !named.some((m) => sameModel(reading.tool, m.model, c.model)));
    if (gone.length > 0) {
      out.push({ tool: reading.tool, models: gone.map((c) => (c.name === c.model ? c.name : `${c.name} (${c.model})`)) });
    }
  }
  return out;
}
