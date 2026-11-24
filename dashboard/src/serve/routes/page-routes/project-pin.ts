// POST /projects/<name>/pin: pin the project on its Config tab, or unpin it
// (`pinned=on|off`). Kept beside the board's checkouts, so nothing is written
// in, or committed to, the project's repository. A refusal changes nothing.

import { isPinned, pinnedFirst, pinnedOf, setPinned } from "../../../project/project-admin/pinned.ts";
import { readObjectBody } from "../../serve-helpers/http.ts";
import { checkoutBase } from "./project-icon-choice.ts";
import { hiddenProjects } from "./project-hide.ts";
import type { RoutesContext } from "..";

/** The pinned projects among those on the board. */
export const pinnedProjects = (ctx: RoutesContext): Set<string> => pinnedOf(checkoutBase(ctx), ctx.allowed);

/** Whether the project is pinned. */
export const projectPinned = (ctx: RoutesContext, name: string): boolean => isPinned(checkoutBase(ctx), name);

/** The board's projects as a list where a project is chosen draws them: the
 *  hidden ones left out, the pinned ones first, each group by name. */
export const projectChoices = (ctx: RoutesContext): string[] => {
  const hidden = hiddenProjects(ctx);
  return pinnedFirst([...ctx.allowed].filter((p) => !hidden.has(p)).sort(), pinnedProjects(ctx), (p) => p);
};

async function pinnedValue(req: Request): Promise<unknown> {
  const sent = await readObjectBody(req, { cap: Number.POSITIVE_INFINITY, form: true });
  return "refusal" in sent ? undefined : sent.body.pinned;
}

export async function projectPinRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const match = path.match(/^\/projects\/([^/]+)\/pin$/);
  if (!match) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const name = decodeURIComponent(match[1]!);
  const answer = (error: string | null) =>
    ctx.answerProjectChange("project-pin", name, [error ? { step: "pin", ok: false, error } : { step: "pin", ok: true }]);
  if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) return answer(`"${name}" is not a project this dashboard knows`);
  const value = await pinnedValue(req);
  if (value !== "on" && value !== "off") return answer("Pin is on or off.");
  setPinned(checkoutBase(ctx), name, value === "on");
  return answer(null);
}
