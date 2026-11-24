import { MAX_SAVE_BODY, bodyToObject, json, readBounded, languageChoice } from "../../serve-helpers";
import type { RoutesContext } from "../index.ts";
import type { Credential } from "../../../queue/waiting";
import { queueEditor } from "../../../render/ui/components/queue-editor";

export async function handleWaitingRoutes(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const match = path.match(/^\/api\/queue\/waiting\/(open|renew|snapshot|save|cancel)$/);
  if (!match) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  // A save names every waiting job twice, by ids that carry the spec's
  // full folder name, so a long queue is larger than an action post.
  const body = await readBounded(req, MAX_SAVE_BODY);
  if ("refusal" in body) return body.refusal;
  let raw: Record<string, unknown>;
  try {
    raw = bodyToObject(body.text, req.headers.get("content-type")) as Record<string, unknown>;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
  } catch { return json({ error: "Malformed queue request" }, 400); }
  try {
    const q = ctx.queue.waiting;
    if (match[1] === "open") {
      if (typeof raw.requestId !== "string") return json({ error: "An opening request id is required" }, 400);
      if (typeof raw.entryId !== "string") return json({ error: "A waiting entry id is required" }, 400);
      const owner = q.open(raw.requestId, raw.entryId);
      const { lang } = languageChoice(new URL(req.url), req);
      return json({ ...owner, html: queueEditor(lang) });
    }
    if (typeof raw.token !== "string" || typeof raw.generation !== "string" || !Number.isSafeInteger(raw.revision)) {
      return json({ error: "Queue editing ownership is required" }, 400);
    }
    const owner = raw as unknown as Credential;
    const result = match[1] === "renew" ? q.renew(owner) : match[1] === "snapshot" ? q.read(owner)
      : match[1] === "cancel" ? q.cancel(owner) : q.save({ ...owner, snapshotIds: raw.snapshotIds as string[] }, raw.ids as string[]);
    if (match[1] === "save" || match[1] === "cancel") {
      ctx.notifyQueueChanged();
      void ctx.tickRunner();
    }
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The queue could not be saved";
    return json({ error: message }, /ownership|order has changed|another tab/.test(message) ? 409 : 400);
  }
}
