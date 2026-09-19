// Dismissing the message a failed create left on the Specs list (spec
// 506). The record stays retrievable by id, so a tap on the notification
// still opens New spec filled in; only the message goes.
import { json } from "../serve-helpers";
import type { RoutesContext } from "./";

const DISMISS = /^\/api\/queue\/failed-creates\/([^/]+)\/dismiss$/;

export function failedCreateRoutes(ctx: RoutesContext, req: Request, path: string, wantsJson: boolean): Response | null {
  const m = DISMISS.exec(path);
  if (!m) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  let id: string;
  try {
    id = decodeURIComponent(m[1]!);
  } catch {
    return json({ ok: false, error: "no such message" }, 404);
  }
  if (!ctx.push.failedCreates.dismiss(id)) return json({ ok: false, error: "no such message" }, 404);
  return wantsJson ? json({ ok: true }) : new Response(null, { status: 303, headers: { location: "/" } });
}
