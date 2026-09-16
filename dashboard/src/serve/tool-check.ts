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

/** OpenCode's own two questions. Neither is answerable for the other
 *  three tools: none of them has a command that lists models, so the
 *  page says so in words rather than showing a result it did not earn. */
async function opencodeExtras(
  opts: CheckOptions,
  run: typeof runScript,
  bin: string,
): Promise<ExtraCheck[]> {
  const out: ExtraCheck[] = [];

  const providers = await run([bin, "providers", "list"], process.cwd(), CHECK_TIMEOUT_MS);
  if (providers.code !== 0 || providers.timedOut) {
    out.push({
      question: "Is a provider logged in?",
      ok: null,
      detail: "opencode providers list could not be run.",
    });
  } else {
    const text = stripAnsi(providers.stdout);
    // "0 credentials" is the CLI's own wording for none configured.
    const none = /\b0 credentials\b/.test(text);
    out.push({
      question: "Is a provider logged in?",
      ok: !none,
      detail: none
        ? "No provider is logged in, so every model call is refused. Run: opencode providers login"
        : lines(text).filter((l) => /credential/i.test(l)).join(" ")
          || "At least one provider is configured.",
    });
  }

  const configured = opts.configuredModels ?? [];
  if (configured.length === 0) {
    out.push({
      question: "Do the configured models still exist?",
      ok: null,
      detail: "No model is configured for this tool, so there is nothing to check.",
    });
    return out;
  }

  const models = await run([bin, "models"], process.cwd(), CHECK_TIMEOUT_MS);
  if (models.code !== 0 || models.timedOut) {
    out.push({
      question: "Do the configured models still exist?",
      ok: null,
      detail: "opencode models could not be run.",
    });
    return out;
  }
  const available = new Set(lines(models.stdout));
  const missing = configured.filter((m) => !available.has(m));
  out.push({
    question: "Do the configured models still exist?",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? `All ${configured.length} still listed.`
      : `Not listed any more: ${missing.join(", ")}`,
  });
  return out;
}

export async function checkTool(tool: CheckableTool, opts: CheckOptions = {}): Promise<ToolCheck> {
  const run = opts.run ?? runScript;
  const path = opts.scriptPath ?? ((name: string) => scriptFor(name));
  const at = (opts.now ?? (() => new Date()))().toISOString();

  const result = await run([path("aide-preflight"), tool], process.cwd(), CHECK_TIMEOUT_MS);
  if (result.timedOut) {
    return {
      tool, at, found: false, lines: [], extra: [],
      error: "The check did not finish in time.",
    };
  }
  const printed = lines(`${result.stdout}\n${result.stderr}`);
  // The preflight's own wording for a CLI it could not find.
  const found = printed.length > 0 && !printed.some((l) => /NOT installed|not found/i.test(l));

  const extra = tool === "opencode"
    ? await opencodeExtras(opts, run, path("opencode"))
    : [];
  return { tool, at, found, lines: printed, extra };
}

/** The last answer obtained for each tool, for as long as this server
 *  process lives. Deliberately not persisted: a check is a measurement
 *  of this machine at one moment, and a restart is exactly the kind of
 *  event that can invalidate it. */
const LAST: Map<CheckableTool, ToolCheck> = new Map();

export function recordCheck(check: ToolCheck): void {
  LAST.set(check.tool, check);
}

export function lastChecks(): Partial<Record<CheckableTool, ToolCheck>> {
  return Object.fromEntries(LAST) as Partial<Record<CheckableTool, ToolCheck>>;
}

/** Test seam: a suite that records a check must not leak it into the
 *  next file's expectations. */
export function forgetChecks(): void {
  LAST.clear();
}

export function isCheckableTool(name: unknown): name is CheckableTool {
  return typeof name === "string" && (CHECKABLE_TOOLS as readonly string[]).includes(name);
}
