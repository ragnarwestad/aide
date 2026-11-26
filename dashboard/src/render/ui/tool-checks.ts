// The last answer each AI's Installation tab gave, what it found wanting,
// and the last reading of each AI's models - one store per dashboard
// server (`createToolReadings`), so two servers in one process never read
// or satisfy each other's checks. The server's wiring hands its store to
// every writer; the header, drawn deep in `shellRest()` with only the
// language in hand, reads the store of the request it is drawn for
// (`withToolReadings`, set where the server answers each request).
//
// It lives HERE rather than beside the code that obtains a check because
// `src/render` may not import `src/serve` (the layering guard in
// `test/guards`), and the header reads it.
//
// Deliberately not persisted: a check is a measurement of this machine
// at one moment, and a restart is exactly the kind of event that can
// invalidate it.

import { AsyncLocalStorage } from "node:async_hooks";
import {
  OTHER_ACCOUNT_PROBLEM, OTHER_ACCOUNT_REMOVAL, TOOL_TAB_LABELS, type CheckableTool, type ToolCheck,
} from "../pages/settings-page/tools.ts";
import { modelLists, sameModel, type ToolModels } from "../pages/settings-page/models.ts";
import type { ModelChoice } from "../../queue/types.ts";
import type { BoardMessage } from "../../messages/types.ts";
import { providerLoginCommand } from "../../queue/providers/login-command.ts";
import { UNANSWERED_MINUTES, unansweredLongEnough } from "./faults/unanswered.ts";

/** One AI's configured models its last reading no longer offers, with the
 *  provider that reading was made for. */
export interface MissingModels {
  tool: CheckableTool;
  models: string[];
  provider?: { key: string; name: string };
}

export interface ToolReadings {
  /** Which tools a run can use — the ones a model is configured for. Read
   *  live, since the configuration can change while the board runs. Unset,
   *  every tool counts. */
  setConfiguredTools(source: () => CheckableTool[]): void;
  /** The model choices as they are now, read live each time the notice is
   *  drawn: a Remove on the Models tab changes them with no new reading. */
  setModelChoices(source: () => Record<string, ModelChoice> | undefined): void;
  /** A finished check replaces the last answer. One that did not finish
   *  keeps it, and starts the time the header counts before it says so. */
  recordCheck(check: ToolCheck): void;
  lastChecks(): Partial<Record<CheckableTool, ToolCheck>>;
  recordModels(models: ToolModels): void;
  lastModels(): Partial<Record<CheckableTool, ToolModels>>;
  /** Which tools this server has found something wrong with, as the header
   *  notice needs it: one message per thing wrong, each with its own fix. A
   *  question nobody could ASK is not a fault - the page says so, and a
   *  banner that fired on it would be on permanently. Nor is a check that
   *  did not finish, until it has gone unanswered for `UNANSWERED_FOR_MS`. */
  toolsWithFaults(now?: number): { tool: CheckableTool; faults: BoardMessage[] }[];
  /** Each AI whose configured models its last Models reading no longer
   *  offers. A reading that failed, an AI the board cannot ask, and an AI
   *  with no reading since the board started name nothing. A Claude name
   *  Claude Code answered for (`opus[1m]`, `opusplan`) is a model it knows. */
  toolsMissingModels(): MissingModels[];
}

/** One server's readings, empty until its checks and tabs record some. */
export function createToolReadings(): ToolReadings {
  const last: Map<CheckableTool, ToolCheck> = new Map();
  /** Since when (ms) each tool's checks have not finished, for as long as
   *  none has: a check the machine was too busy to finish is no answer. */
  const unanswered: Map<CheckableTool, number> = new Map();
  /** The last reading of each tool's models, kept apart for the same
   *  reason as the usage: only a provider's Models tab reads them. */
  const models: Map<CheckableTool, ToolModels> = new Map();
  let configured: (() => CheckableTool[]) | undefined;
  let choices: (() => Record<string, ModelChoice> | undefined) | undefined;
  return {
    setConfiguredTools: (source) => { configured = source; },
    setModelChoices: (source) => { choices = source; },
    recordCheck(check) {
      if (check.unfinished) {
        if (!unanswered.has(check.tool)) unanswered.set(check.tool, Date.parse(check.at) || Date.now());
        return;
      }
      unanswered.delete(check.tool);
      last.set(check.tool, check);
    },
    lastChecks: () => Object.fromEntries(last) as Partial<Record<CheckableTool, ToolCheck>>,
    recordModels: (reading) => { models.set(reading.tool, reading); },
    lastModels: () => Object.fromEntries(models) as Partial<Record<CheckableTool, ToolModels>>,
    toolsWithFaults: (now = Date.now()) => faultsOf(last, unanswered, configured?.(), now),
    toolsMissingModels: () => missingModels(models.values(), choices?.()),
  };
}

const SCOPE = new AsyncLocalStorage<ToolReadings>();

/** Runs `run` with `readings` as the store the header reads. */
export function withToolReadings<T>(readings: ToolReadings, run: () => T): T {
  return SCOPE.run(readings, run);
}

/** The readings of the server answering the current request; undefined
 *  outside one, where the header draws no tool notice. */
export function currentToolReadings(): ToolReadings | undefined {
  return SCOPE.getStore();
}

function faultsOf(
  last: Map<CheckableTool, ToolCheck>,
  unanswered: Map<CheckableTool, number>,
  configured: CheckableTool[] | undefined,
  now: number,
): { tool: CheckableTool; faults: BoardMessage[] }[] {
  // A tool no model is configured for is never run, so its login is not
  // what stands between a reader and a working run.
  const usable = configured ? new Set(configured) : undefined;
  const tools = new Set<CheckableTool>([...last.keys(), ...unanswered.keys()]);
  const out: { tool: CheckableTool; faults: BoardMessage[] }[] = [];
  for (const tool of tools) {
    if (usable && !usable.has(tool)) continue;
    const since = unanswered.get(tool);
    const faults = since !== undefined && unansweredLongEnough(since, now)
      ? [{ key: "tools.unanswered", values: { tool: TOOL_TAB_LABELS[tool], minutes: UNANSWERED_MINUTES } } as BoardMessage]
      : checkFaults(last.get(tool));
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

function missingModels(
  readings: Iterable<ToolModels>,
  live: Record<string, ModelChoice> | undefined,
): MissingModels[] {
  const out: MissingModels[] = [];
  for (const reading of readings) {
    if (reading.error) continue;
    const named = reading.named ?? [];
    const gone = modelLists(reading.tool, live, reading).gone
      .filter((c) => !named.some((m) => sameModel(reading.tool, m.model, c.model)));
    if (gone.length > 0) {
      const models = gone.map((c) => (c.name === c.model ? c.name : `${c.name} (${c.model})`));
      const provider = reading.providerKey ? { key: reading.providerKey, name: reading.provider ?? reading.providerKey } : undefined;
      out.push({ tool: reading.tool, models, ...(provider ? { provider } : {}) });
    }
  }
  return out;
}
