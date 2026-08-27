// Take a project off the allowlist.

import { fail, type ProjectAdminResult, type ProjectStep } from "./types.ts";

/** Take a project off the allowlist, and do nothing else at all.
 *
 *  Removal must never delete a repo or a specs root — so this function
 *  touches no filesystem, and there is nothing in it that could. The
 *  name has to be typed back exactly: a click alone is not a deliberate
 *  enough act for something that takes a project off the dashboard, and
 *  the browser's own match-check is a convenience over this, not a
 *  substitute for it. Persisting the result is the caller's, for the
 *  same reason `addProject` does not do it: the allowlist lives in the
 *  server's own `Set`, which is the single source of truth every
 *  request is filtered against. */
export function removeProject(
  allowed: Set<string>,
  req: { name: string; confirm: unknown },
): ProjectAdminResult {
  if (typeof req.confirm !== "string" || req.confirm !== req.name) {
    return fail("confirm", `type the project's name exactly — "${req.name}" — to remove it`);
  }
  const steps: ProjectStep[] = [{ step: "confirm", ok: true }];
  if (!allowed.has(req.name)) {
    steps.push({ step: "allowlist", ok: false, error: `"${req.name}" is not on the allowlist` });
    return { ok: false, steps };
  }
  allowed.delete(req.name);
  steps.push({ step: "allowlist", ok: true });
  return { ok: true, steps };
}
