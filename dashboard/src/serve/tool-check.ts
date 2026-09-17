// Asking a tool whether it is actually usable on this host.
//
// The knowledge of WHAT aide installs for each tool, and where, lives in
// `core/scripts/aide-preflight` and nowhere else. This module runs that
// script and passes on what it said; it does not keep a second copy of
// the answer in TypeScript. The dashboard already pays for several
// hand-paired bash/TypeScript decisions (`docs/bash-typescript-decisions.md`)
// and this is one it does not have to.
//
// What the preflight cannot answer is asked separately, and only where
// there is something to ask: OpenCode reaches a model through a provider
// and can list what that provider offers, so its own two questions are
// answerable. The other three CLIs have no command that lists models at
// all, which is why the extra checks cover one tool rather than four.

import { runScript, scriptFor } from "./land-branch/run-script.ts";
import { forgetChecks, lastChecks, recordCheck, toolsWithFaults } from "../render/ui/tool-checks.ts";

// The store lives in the render layer, which is where both readers are
// and which may not import this file. Re-exported so a caller has one
// import site for "check a tool and remember the answer".
export { forgetChecks, lastChecks, recordCheck, toolsWithFaults };
import { CHECKABLE_TOOLS } from "../render";
import type { CheckableTool, ExtraCheck, ToolCheck } from "../render";

export { CHECKABLE_TOOLS };
export type { CheckableTool, ExtraCheck, ToolCheck };

/** Long enough for a version probe and a directory walk, short enough
 *  that a hung CLI cannot hold a request handler open - the same
 *  bounded-timeout discipline every other spawn here has. */
export const CHECK_TIMEOUT_MS = 20_000;

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

/** Terminal colour, removed: the preflight writes for a terminal and the
 *  page is not one. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

const lines = (text: string): string[] =>
  stripAnsi(text).split("\n").map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);

export interface CheckOptions {
  /** The configured model names for this tool, as the CLI would be given
   *  them. Only OpenCode can be asked whether they still exist. */
  configuredModels?: string[];
  /** Test seam: what to run instead of the real binaries. */
  run?: typeof runScript;
  /** Test seam: where to find the scripts. */
  scriptPath?: (name: string) => string;
  now?: () => Date;
}

/** OpenCode reaches a model through a PROVIDER, so a provider IS its
 *  credential: this is the same "is it logged in" question the other
 *  three answer with a status command, asked the way OpenCode can
 *  answer it. */
async function opencodeProviderCheck(
  run: typeof runScript,
  bin: string,
): Promise<ExtraCheck> {
  const question = "Is it logged in?";
  const providers = await run([bin, "providers", "list"], process.cwd(), CHECK_TIMEOUT_MS);
  if (providers.code !== 0 || providers.timedOut) {
    return { question, ok: null, detail: "opencode providers list could not be run." };
  }
  const text = stripAnsi(providers.stdout);
  // "0 credentials" is the CLI's own wording for none configured.
  const none = /\b0 credentials\b/.test(text);
  return {
    question,
    ok: !none,
    detail: none
      ? "No provider is logged in, so every model call is refused. Run `opencode providers login`."
      : lines(text).filter((l) => /credential/i.test(l)).join(" ")
        || "At least one provider is configured.",
  };
}

/** Whether every model configured for OpenCode still exists. The one
 *  question none of the other three can be asked: no other CLI has a
 *  command that lists the models it accepts. */
async function opencodeModelCheck(
  opts: CheckOptions,
  run: typeof runScript,
  bin: string,
): Promise<ExtraCheck> {
  const question = "Do the configured models still exist?";
  const configured = opts.configuredModels ?? [];
  if (configured.length === 0) {
    return {
      question,
      ok: null,
      detail: "No model is configured for this tool, so there is nothing to check.",
    };
  }
  const models = await run([bin, "models"], process.cwd(), CHECK_TIMEOUT_MS);
  if (models.code !== 0 || models.timedOut) {
    return { question, ok: null, detail: "opencode models could not be run." };
  }
  const available = new Set(lines(models.stdout));
  const missing = configured.filter((m) => !available.has(m));
  return {
    question,
    ok: missing.length === 0,
    detail: missing.length === 0
      ? `All ${configured.length} still listed.`
      : `Not listed any more: ${missing.join(", ")}`,
  };
}


/** Which account and plan `claude auth status` says it runs on — asked
 *  from the board's own process, so it names the login a run will use,
 *  which a terminal's own login need not be. The organization is named
 *  only when it is one of its own, not the default one every personal
 *  account gets ("<email>'s Organization"). */
function claudeAccount(parsed: Record<string, unknown>): string {
  const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
  const email = str(parsed.email);
  const org = str(parsed.orgName);
  const plan = str(parsed.subscriptionType);
  const parts = [
    email,
    org && org !== `${email}'s Organization` ? org : undefined,
    plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : undefined,
  ].filter((p): p is string => !!p);
  return parts.length ? ` — ${parts.join(", ")}` : "";
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
 *  by looking for a file. Three of the four have a command for it; the
 *  fourth has none, and says so rather than guessing from a token file
 *  whose location the CLI is free to change.
 *
 *  Verified 2026-09-16: `claude auth status` prints JSON with a
 *  `loggedIn` boolean; `codex login status` prints one line and exits 0
 *  when logged in; `copilot` has `login` and `logout` and no status
 *  subcommand at all. OpenCode is asked through its providers instead,
 *  which is the same question one layer out - it reaches a model through
 *  a provider, so a provider IS the credential. */
async function loginCheck(
  tool: CheckableTool,
  run: typeof runScript,
  bin: string,
): Promise<ExtraCheck> {
  const question = "Is it logged in?";
  if (tool === "copilot") {
    return {
      question,
      ok: null,
      detail: "The Copilot CLI has no command that reports it. Run `copilot login` if a run is refused.",
    };
  }

  const argv = tool === "claude" ? [bin, "auth", "status"] : [bin, "login", "status"];
  const result = await run(argv, process.cwd(), CHECK_TIMEOUT_MS);
  if (result.timedOut) {
    return { question, ok: null, detail: `${argv.slice(1).join(" ")} did not finish in time.` };
  }
  const text = stripAnsi(`${result.stdout}\n${result.stderr}`).trim();

  if (tool === "claude") {
    // Its own JSON, which is the answer rather than a sentence to read.
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed.loggedIn === "boolean") {
        const how = typeof parsed.authMethod === "string" ? ` (${parsed.authMethod})` : "";
        if (!parsed.loggedIn) return { question, ok: false, detail: "No. Run `claude auth login`." };
        const mixed = mixedLogins(parsed);
        return {
          question,
          ok: !mixed,
          detail: `Yes${how}${claudeAccount(parsed)}.${mixed ? ` ${mixed}` : ""}`,
        };
      }
    } catch {
      // Falls through to the exit code below: a version that stops
      // printing JSON is not a version this can claim an answer from.
    }
    return { question, ok: null, detail: "claude auth status did not answer in a shape this knows." };
  }

  // Codex: one line, and an exit code that says it.
  if (result.code !== 0) {
    return { question, ok: false, detail: text || "No. Run `codex login`." };
  }
  return { question, ok: true, detail: text || "Yes." };
}

export async function checkTool(tool: CheckableTool, opts: CheckOptions = {}): Promise<ToolCheck> {
  const path = opts.scriptPath ?? ((name: string) => scriptFor(name));
  const at = (opts.now ?? (() => new Date()))().toISOString();
  // Every command this check runs, recorded as it runs. A reader who
  // needs to go further than the page can take them runs the same line
  // in a terminal and sees everything, rather than guessing at what was
  // asked.
  const commands: string[] = [];
  const base = opts.run ?? runScript;
  const run: typeof runScript = (argv, cwd, timeoutMs) => {
    commands.push(argv.join(" "));
    return base(argv, cwd, timeoutMs);
  };

  const result = await run([path("aide-preflight"), tool], process.cwd(), CHECK_TIMEOUT_MS);
  if (result.timedOut) {
    return {
      tool, at, found: false, lines: [], extra: [], commands,
      error: "The check did not finish in time.",
    };
  }
  const printed = lines(`${result.stdout}\n${result.stderr}`);
  // The preflight's own wording for a CLI it could not find.
  const found = printed.length > 0 && !printed.some((l) => /NOT installed|not found/i.test(l));

  // A CLI that is not there cannot be asked anything, and asking would
  // report "not logged in" for what is really "not installed".
  const extra: ExtraCheck[] = [];
  if (found) {
    extra.push(
      tool === "opencode"
        ? await opencodeProviderCheck(run, path("opencode"))
        : await loginCheck(tool, run, path(tool)),
    );
    if (tool === "opencode") {
      extra.push(await opencodeModelCheck(opts, run, path("opencode")));
    }
  }
  return { tool, at, found, lines: printed, extra, commands };
}

export function isCheckableTool(name: unknown): name is CheckableTool {
  return typeof name === "string" && (CHECKABLE_TOOLS as readonly string[]).includes(name);
}

/** Run every check once, for a server that has just come up.
 *
 *  Started AFTER the server begins answering, never before: the whole
 *  round takes about two seconds on a healthy machine, but a CLI that
 *  hangs is bounded only by `CHECK_TIMEOUT_MS`, and no page should wait
 *  on that. Failures are swallowed on purpose — a check that cannot run
 *  is a check with no answer, not a server that should refuse to
 *  serve. */
export async function checkAllTools(
  configuredModels: (tool: CheckableTool) => string[],
  opts: Omit<CheckOptions, "configuredModels"> = {},
): Promise<void> {
  for (const tool of CHECKABLE_TOOLS) {
    try {
      recordCheck(await checkTool(tool, { ...opts, configuredModels: configuredModels(tool) }));
    } catch {
      // Nothing to record and nothing to say: the tab still reads "not
      // checked yet", which is true.
    }
  }
}
