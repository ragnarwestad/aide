// The last answer each AI's Check gave, and what it found wanting -
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

import type { CheckableTool, ToolCheck } from "../pages/settings-page/tools.ts";

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

/** Which tools this server has found something wrong with, as the header
 *  notice needs it: the tool's own name and the questions that came back
 *  "no". A question nobody could ASK is not a fault - the page says so
 *  on the tab, and a banner that fired on it would be on permanently for
 *  Copilot, which has no status command at all. */
export function toolsWithFaults(): { tool: CheckableTool; problems: string[] }[] {
  const out: { tool: CheckableTool; problems: string[] }[] = [];
  for (const check of LAST.values()) {
    const problems: string[] = [];
    if (check.error) problems.push(check.error);
    else if (!check.found) problems.push("not installed");
    for (const entry of check.extra) {
      if (entry.ok === false) problems.push(entry.question.replace(/\?$/, "").toLowerCase());
    }
    if (problems.length > 0) out.push({ tool: check.tool, problems });
  }
  return out;
}
