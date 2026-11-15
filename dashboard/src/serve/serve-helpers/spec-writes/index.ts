import { groupReservesSpec } from "../../../queue/execution-groups";
import type { QueueStore } from "../../../queue/queue.ts";
import { json } from "../http.ts";
import { logRefusal } from "../edit-sentences.ts";

/** A policy check shared by the spec's write routes, before any handler runs. */
export function refuseReservedSpecWrite(queue: QueueStore, req: Request, path: string): Response | undefined {
  const parts = path.split("/");
  const [project, folder, action] = parts.slice(4);
  const protectsSpec = parts.length === 7 && parts.slice(0, 4).join("/") === "/api/queue/specs" &&
    ["close", "save", "tracking", "tick", "approach", "delete-branch", "test-server"].includes(action ?? "");
  if (req.method !== "POST" || !protectsSpec || !groupReservesSpec(queue, project!, folder!)) return undefined;
  const spec = `${project}/${folder}`;
  const error = "this spec belongs to an active group — nothing was changed";
  logRefusal(action!, spec, error);
  return json({ error, spec }, 409);
}
