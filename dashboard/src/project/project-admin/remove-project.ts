// Take a project off the allowlist.

import { type ProjectAdminResult, type ProjectStep } from "./types.ts";

/** Take a project off the allowlist, and do nothing else at all.
 *
 *  Removal must never delete a repo or a specs root — so this function
 *  touches no filesystem, and there is nothing in it that could. That
 *  is what makes the press enough on its own: what a mistaken Remove
 *  costs is the allowlist entry, and adding it back is the Add page.
 *  Persisting the result is the caller's, for the
 *  same reason `addProject` does not do it: the allowlist lives in the
 *  server's own `Set`, which is the single source of truth every
 *  request is filtered against. */
export function removeProject(
  allowed: Set<string>,
  req: { name: string },
): ProjectAdminResult {
  // The typed name is gone (2026-09-08): the Remove page asks the
  // question in a sentence, and the press is the answer. The step
  // itself stays in the result — every caller reads the list of steps,
  // and a removal that reports one fewer of them than it used to would
  // read as a removal that skipped something.
  const steps: ProjectStep[] = [{ step: "confirm", ok: true }];
  if (!allowed.has(req.name)) {
    steps.push({ step: "allowlist", ok: false, error: `"${req.name}" is not on the allowlist` });
    return { ok: false, steps };
  }
  allowed.delete(req.name);
  steps.push({ step: "allowlist", ok: true });
  return { ok: true, steps };
}
