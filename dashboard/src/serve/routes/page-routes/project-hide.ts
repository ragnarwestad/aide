// POST /projects/<name>/hide: hide the project on its Config tab, or show it
// (`hidden=on|off`). Kept beside the board's checkouts, so nothing is written
// in, or committed to, the project's repository. A refusal changes nothing.

import { hiddenOf, isHidden, setHidden } from "../../../project/project-admin/hidden.ts";
import { readObjectBody } from "../../serve-helpers/http.ts";
import { checkoutBase } from "./project-icon-choice.ts";
import type { RoutesContext } from "..";

/** The hidden projects among those on the board. */
export const hiddenProjects = (ctx: RoutesContext): Set<string> => hiddenOf(checkoutBase(ctx), ctx.allowed);

/** Whether the project is hidden. */
export const projectHidden = (ctx: RoutesContext, name: string): boolean => isHidden(checkoutBase(ctx), name);

async function hiddenValue(req: Request): Promise<unknown> {
  const sent = await readObjectBody(req, { cap: Number.POSITIVE_INFINITY, form: true });
  return "refusal" in sent ? undefined : sent.body.hidden;
}

export async function projectHideRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const match = path.match(/^\/projects\/([^/]+)\/hide$/);
  if (!match) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const name = decodeURIComponent(match[1]!);
  const answer = (error: string | null) =>
    ctx.answerProjectChange("project-hide", name, [error ? { step: "hide", ok: false, error } : { step: "hide", ok: true }]);
  if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) return answer(`"${name}" is not a project this dashboard knows`);
  const value = await hiddenValue(req);
  if (value !== "on" && value !== "off") return answer("Hide is on or off.");
  setHidden(checkoutBase(ctx), name, value === "on");
  return answer(null);
}
