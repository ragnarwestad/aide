// Asking a tool whether it is actually usable on this host.
//
// WHERE aide installs for each tool lives in
// `core/scripts/lib/install-targets.txt`: `core/scripts/aide-preflight
// --facts` answers from it whether each place exists, whether the files are
// behind and whether the CLI is found, and the Installation tab lists the
// same places (`render/pages/settings-page/places.ts`). This module runs
// the preflight and reads its facts; it does not decide any of them a
// second time in TypeScript (`docs/bash-typescript-decisions.md`, "Not a
// pair: where aide installs for each AI").
//
// What the preflight cannot answer is asked separately, and only where
// there is something to ask: whether the AI is logged in, and for OpenCode
// whether a provider is. Which models each AI offers is read by a provider's
// Models tab alone (`tool-models/`), never by this check, which also runs at
// start and before waiting jobs.

import { homedir } from "node:os";
import { runScript, scriptFor } from "./process";
import { expandDir, providerLoginCommand, providerLoginEnv, type Provider } from "../queue/providers/index.ts";
import { TOOLS, type ProviderTool } from "../queue/providers/tools.ts";
import { TOOL_READERS } from "./tool-readers/index.ts";
import { CHECK_TIMEOUT_MS, stripAnsi } from "./tool-readers/run.ts";
import { forgetChecks, lastChecks, recordCheck, setConfiguredTools, setModelChoices, toolsWithFaults } from "../render/ui/tool-checks.ts";

// The store lives in the render layer, which is where both readers are
// and which may not import this file. Re-exported so a caller has one
// import site for "check a tool and remember the answer".
export { forgetChecks, lastChecks, recordCheck, setConfiguredTools, setModelChoices, toolsWithFaults };
import { CHECKABLE_TOOLS } from "../render";
import type { CheckableTool, ExtraCheck, ToolCheck } from "../render";
import type { BoardMessage } from "../messages/types.ts";

export { CHECKABLE_TOOLS };
export type { CheckableTool, ExtraCheck, ToolCheck };

/** Long enough for a version probe and a directory walk, short enough
 *  that a hung CLI cannot hold a request handler open - the same
 *  bounded-timeout discipline every other spawn here has. */
export { CHECK_TIMEOUT_MS, stripAnsi };

const printedLines = (text: string): string[] =>
  stripAnsi(text).split("\n").map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);

/** What `aide-preflight --facts` said; undefined when it gave no `cli`
 *  line, which an older preflight does not: it answers `--facts` with its
 *  banner and then "Unknown tool", and that is not a CLI that is missing. */
function readFacts(text: string): { found: boolean; missing: string[]; paths: Record<string, string>; behind: boolean } | undefined {
  const facts = printedLines(text).map((l) => l.split("\t"));
  const cli = facts.find((f) => f[0] === "cli");
  if (!cli) return undefined;
  return {
    found: cli[1] === "found",
    missing: facts.filter((f) => f[0] === "place" && f[3] === "missing").map((f) => f[1]!),
    paths: Object.fromEntries(facts.filter((f) => f[0] === "place" && f[2]).map((f) => [f[1]!, f[2]!])),
    behind: facts.some((f) => f[0] === "files" && f[1] === "behind"),
  };
}

export interface CheckOptions {
  /** Test seam: what to run instead of the real binaries. */
  run?: typeof runScript;
  /** Test seam: where to find the scripts. */
  scriptPath?: (name: string) => string;
  /** Where the board's runner is: the preflight is looked for beside it
   *  first, so a board serving a branch runs that branch's preflight. */
  scriptDir?: string;
  now?: () => Date;
  /** The providers whose logins are asked, live: a tool's check asks the
   *  login of each provider of that tool, and its own login when it has
   *  none. */
  providers?: () => Record<string, Provider> | undefined;
  /** Test seam: the home directory a provider's folder is expanded against. */
  home?: string;
}

const LOGIN_QUESTION = "Is it logged in?";

/** A login answer that could not be obtained: no answer, never a "no".
 *  `command` is the one that was asked, as a reader would type it. */
function loginUnknown(how: "timedOut" | "unreadable", command: string): ExtraCheck {
  return {
    question: LOGIN_QUESTION, ok: null, detail: "",
    answer: { key: how === "timedOut" ? "login.timedOut" : "login.unreadable", values: { command } },
  };
}

/** Not logged in, with the command that logs it in. */
function loginOut(command: string): ExtraCheck {
  return {
    question: LOGIN_QUESTION, ok: false, detail: "", problem: "not logged in",
    answer: { key: "login.out", values: { command } },
  };
}

/** Logged in: how, and as whom, as far as the tool says either. */
function loggedIn(method: string | undefined, account: string | undefined): BoardMessage {
  if (method && account) return { key: "login.inWithAs", values: { method, account } };
  if (method) return { key: "login.inWith", values: { method } };
  if (account) return { key: "login.inAs", values: { account } };
  return { key: "login.in" };
}

const NO_CREDENTIALS = /\b0 credentials\b|No authenticated integrations/;

/** OpenCode reaches a model through a PROVIDER, so a provider IS its
 *  credential: this is the same "is it logged in" question the other
 *  three answer with a status command, asked the way OpenCode can
 *  answer it. */
async function opencodeProviderCheck(
  run: typeof runScript,
  bin: string,
  command: string,
): Promise<ExtraCheck> {
  const providers = await run([bin, "auth", "list"], process.cwd(), CHECK_TIMEOUT_MS);
  if (providers.timedOut) return loginUnknown("timedOut", "opencode auth list");
  if (providers.code !== 0) return loginUnknown("unreadable", "opencode auth list");
  // The CLI's own wording for none configured: "0 credentials" before
  // version 2, "No authenticated integrations" from it.
  if (NO_CREDENTIALS.test(stripAnsi(providers.stdout))) return loginOut(command);
  return { question: LOGIN_QUESTION, ok: true, detail: "", answer: loggedIn(undefined, undefined) };
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/** Which account and plan `claude auth status` says it runs on — asked
 *  from the board's own process, so it names the login a run will use,
 *  which a terminal's own login need not be. The organization is named
 *  only when it is one of its own, not the default one every personal
 *  account gets ("<email>'s Organization"). Undefined when it names none
 *  of them. */
function claudeAccount(parsed: Record<string, unknown>): string | undefined {
  const email = str(parsed.email);
  const org = str(parsed.orgName);
  const plan = str(parsed.subscriptionType);
  const parts = [
    email,
    org && org !== `${email}'s Organization` ? org : undefined,
    plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : undefined,
  ].filter((p): p is string => !!p);
  return parts.length ? parts.join(", ") : undefined;
}

/** `claude auth status` reads the address and organization from one
 *  file and the plan from the stored login itself, and the two can be
 *  different logins: one left in the keychain after `claude auth login`
 *  wrote a new one to the file. Runs use the stored one, so the check
 *  names an account runs do not spend. An organization plan on a
 *  personal organization is the one pairing that cannot be real. */
function mixedLogins(parsed: Record<string, unknown>): string | undefined {
  const plan = typeof parsed.subscriptionType === "string" ? parsed.subscriptionType : "";
  const personal = typeof parsed.email === "string" && parsed.orgName === `${parsed.email}'s Organization`;
  if (!personal || (plan !== "team" && plan !== "enterprise")) return undefined;
  const name = plan.charAt(0).toUpperCase() + plan.slice(1);
  return (
    `A ${name} plan does not belong to a personal account: the stored login is probably another account's ` +
    "than the one named here, and runs use that one. On macOS it lives in the keychain: remove it with `security delete-generic-password -s \"Claude Code-credentials\"` and check again."
  );
}

/** Whether the tool has credentials, asked of the tool itself and never
 *  by looking for a file.
 *
 *  Verified 2026-09-16: `claude auth status` prints JSON with a
 *  `loggedIn` boolean; `codex login status` prints one line and exits 0
 *  when logged in. OpenCode is asked through its providers instead,
 *  which is the same question one layer out - it reaches a model through
 *  a provider, so a provider IS the credential. */
async function loginCheck(
  tool: ProviderTool,
  claude: boolean,
  run: typeof runScript,
  bin: string,
  command: string,
  env: Record<string, string>,
): Promise<ExtraCheck> {
  const args = claude ? ["auth", "status"] : ["login", "status"];
  const asked = [tool, ...args].join(" ");
  const result = await run([bin, ...args], process.cwd(), CHECK_TIMEOUT_MS, undefined, env);
  if (result.timedOut) return loginUnknown("timedOut", asked);
  const text = stripAnsi(`${result.stdout}\n${result.stderr}`).trim();

  if (claude) {
    // Its own JSON, which is the answer rather than a sentence to read.
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed.loggedIn === "boolean") {
        if (!parsed.loggedIn) return loginOut(command);
        const mixed = mixedLogins(parsed);
        const ends = loginEnds(parsed.loginExpiresAt);
        const plan = str(parsed.subscriptionType);
        return {
          question: LOGIN_QUESTION,
          ok: !mixed,
          // Only what follows the answer: the tab draws the answer itself.
          detail: mixed ?? "",
          answer: loggedIn(str(parsed.authMethod), claudeAccount(parsed)),
          ...(mixed ? { problem: "the login in use is another account's" } : {}),
          ...(ends ? { ends } : {}),
          ...(plan ? { plan: plan.charAt(0).toUpperCase() + plan.slice(1) } : {}),
        };
      }
    } catch {
      // Falls through: a version that stops printing JSON is not a
      // version this can claim an answer from.
    }
    return loginUnknown("unreadable", asked);
  }

  // Codex: one line, "Logged in using <how>", and an exit code that says it.
  if (result.code !== 0) return loginOut(command);
  const how = /^Logged in using (.+)$/m.exec(text)?.[1]?.trim();
  return { question: LOGIN_QUESTION, ok: true, detail: "", answer: loggedIn(how, undefined) };
}

/** The time a login ends, as an ISO time, from what `claude auth status`
 *  prints as `loginExpiresAt`: a time string, or a number of milliseconds
 *  (one under 10^12 is read as seconds). Anything else is no answer. */
function loginEnds(value: unknown): string | undefined {
  let ms: number | undefined;
  if (typeof value === "string") ms = Date.parse(value);
  else if (typeof value === "number" && Number.isFinite(value)) ms = value < 1e12 ? value * 1000 : value;
  if (ms === undefined || Number.isNaN(ms)) return undefined;
  const when = new Date(ms);
  return Number.isNaN(when.getTime()) ? undefined : when.toISOString();
}

/** One login question for a tool: its own, or — given a provider — the one
 *  a step on that provider would meet, asked with the provider's folder in
 *  the environment, answered with the provider's own login command, and
 *  carrying the provider's name. */
export async function askLogin(
  tool: CheckableTool,
  run: typeof runScript,
  bin: string,
  provider?: Provider,
  home: string = homedir(),
): Promise<ExtraCheck> {
  const env = provider ? providerLoginEnv(provider, home) : {};
  const command = provider ? providerLoginCommand(provider) : providerLoginCommand({ tool });
  const loginReaders = {
    claude: () => loginCheck("claude", true, run, bin, command, env),
    codex: () => loginCheck("codex", false, run, bin, command, env),
    opencode: () => opencodeProviderCheck((argv, cwd, ms) => run(argv, cwd, ms, undefined, env), bin, command),
  };
  const answer = await loginReaders[TOOL_READERS[TOOLS[tool].readers.login].login]();
  if (!provider) return answer;
  const problem = answer.ok === false
    ? answer.problem === "not logged in" ? `${provider.name} not logged in` : `${provider.name}: ${answer.problem ?? "login"}`
    : undefined;
  return { ...answer, provider: provider.name, ...(problem ? { problem } : {}) };
}

export async function checkTool(tool: CheckableTool, opts: CheckOptions = {}): Promise<ToolCheck> {
  const path = opts.scriptPath ?? ((name: string) => scriptFor(name));
  const at = (opts.now ?? (() => new Date()))().toISOString();
  const run = opts.run ?? runScript;

  const preflight = opts.scriptDir ? scriptFor("aide-preflight", { beside: opts.scriptDir }) : path("aide-preflight");
  const result = await run([preflight, "--facts", tool], process.cwd(), CHECK_TIMEOUT_MS);
  if (result.timedOut) {
    return { tool, at, found: false, extra: [], error: "The check did not finish in time." };
  }
  const facts = result.code === 0 ? readFacts(result.stdout) : undefined;
  if (!facts) {
    const said = printedLines(`${result.stdout}\n${result.stderr}`).pop();
    return {
      tool, at, found: false, extra: [],
      error: `The check gave no answer the board can read${said ? `: ${said}` : "."}`,
    };
  }
  const { found, missing, paths, behind } = facts;

  // A CLI that is not there cannot be asked anything, and asking would
  // report "not logged in" for what is really "not installed".
  const extra: ExtraCheck[] = [];
  if (found) {
    // A switched-off provider runs nothing, so its login is no fault.
    const own = Object.values(opts.providers?.() ?? {}).filter((p) => p.tool === tool && p.enabled !== false);
    if (own.length === 0) extra.push(await askLogin(tool, run, path(tool)));
    for (const provider of own) {
      const bin = provider.binary ? expandDir(provider.binary, opts.home ?? homedir()) : path(tool);
      extra.push(await askLogin(tool, run, bin, provider, opts.home));
    }
  }
  return { tool, at, found, missing, paths, behind, extra };
}

/** Run every check once, for a server that has just come up.
 *
 *  Started AFTER the server begins answering, never before: the whole
 *  round takes about two seconds on a healthy machine, but a CLI that
 *  hangs is bounded only by `CHECK_TIMEOUT_MS`, and no page should wait
 *  on that. Failures are swallowed on purpose — a check that cannot run
 *  is a check with no answer, not a server that should refuse to
 *  serve. */
export async function checkAllTools(opts: CheckOptions = {}): Promise<void> {
  for (const tool of CHECKABLE_TOOLS) {
    try {
      recordCheck(await checkTool(tool, opts));
    } catch {
      // Nothing to record and nothing to say: the tab still reads "not
      // checked yet", which is true.
    }
  }
}

/** How long a check answers for a tool before a waiting job asks again. */
export const RECHECK_MS = 60_000;

/** Asks again, for the tools waiting jobs are about to run on, whether
 *  each is usable — at most once per `RECHECK_MS` per tool, and never
 *  twice at once. What the notice on every page says is then the login a
 *  run will use now, not the one the board found when it started: a
 *  login changed under a running board is how seven runs were spent on
 *  the wrong account. */
export function toolRechecker(
  opts: CheckOptions & { check?: (tool: CheckableTool) => Promise<ToolCheck> } = {},
): (tools: CheckableTool[]) => Promise<void> {
  const inFlight = new Set<CheckableTool>();
  const now = opts.now ?? (() => new Date());
  const check = opts.check ?? ((tool: CheckableTool) => checkTool(tool, opts));
  return async (tools) => {
    await Promise.all([...new Set(tools)].map(async (tool) => {
      const last = lastChecks()[tool];
      if (inFlight.has(tool)) return;
      if (last && now().getTime() - Date.parse(last.at) < RECHECK_MS) return;
      inFlight.add(tool);
      try {
        recordCheck(await check(tool));
      } catch {
        // No answer is no new answer: the last one stands.
      } finally {
        inFlight.delete(tool);
      }
    }));
  };
}
