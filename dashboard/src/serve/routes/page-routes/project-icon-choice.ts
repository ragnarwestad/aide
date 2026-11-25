// POST /projects/<name>/icon: choose the project's icon on its Config tab —
// a built-in icon and a colour (`choice=glyph&glyph=&hue=`), a file of the
// reader's own read into the form as base64 (`choice=file&filename=&data=`),
// or Automatic (`choice=automatic`). Kept beside the board's checkouts, so
// nothing is written in, or committed to, the project's repository.

import {
  ICON_FILE_MAX,
  clearChosenIcon,
  writeChosenFile,
  writeChosenGlyph,
} from "../../../project/project-icon/index.ts";
import { DEFAULT_DASHBOARD_CHECKOUT_ROOT } from "../../../git/dashboard-checkout/index.ts";
import { readObjectBody } from "../../serve-helpers/http.ts";
import type { RoutesContext } from "..";

/** The largest body the route reads: a 512 KB file as base64, every
 *  character of it URL-encoded as three, and room for the other fields. */
export const ICON_BODY_CAP = Math.ceil(ICON_FILE_MAX / 3) * 4 * 3 + 4096;

/** Where the board keeps what it holds for each project, the chosen icon among it. */
export const checkoutBase = (ctx: RoutesContext): string => ctx.opts.dashboardCheckoutRoot ?? DEFAULT_DASHBOARD_CHECKOUT_ROOT;

/** What the choice posted, done; a refusal changes nothing. */
function choose(base: string, name: string, form: Record<string, unknown>): string | null {
  const get = (key: string): string => (typeof form[key] === "string" ? form[key] : "");
  const choice = get("choice");
  if (choice === "automatic") {
    clearChosenIcon(base, name);
    return null;
  }
  if (choice === "glyph") return writeChosenGlyph(base, name, get("glyph"), Number(get("hue")));
  if (choice === "file") {
    const filename = get("filename");
    const data = get("data");
    if (!filename || !data) return "No file was picked.";
    return writeChosenFile(base, name, filename, new Uint8Array(Buffer.from(data, "base64")));
  }
  return "Choose a built-in icon, a file or Automatic.";
}

export async function chooseProjectIcon(ctx: RoutesContext, req: Request, name: string): Promise<Response> {
  const answer = (error: string | null) =>
    ctx.answerProjectChange("project-icon", name, [error ? { step: "icon", ok: false, error } : { step: "icon", ok: true }]);
  if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) return answer(`"${name}" is not a project this dashboard knows`);
  const sent = await readObjectBody(req, { cap: ICON_BODY_CAP, form: true });
  // Over the cap the body was never read, so the file's own size is not known.
  if ("refusal" in sent) return answer(sent.refusal.status === 413 ? "The file is larger than 512 KB." : "No file was picked.");
  return answer(choose(checkoutBase(ctx), name, sent.body));
}
