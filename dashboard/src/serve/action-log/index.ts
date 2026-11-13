// Every action that went through leaves a line in the server's log: what
// was done, from where, and to which job; the job keeps the same entry.
// A refusal is logged where it is refused, so only a success is written
// here. A read, and a POST a page sends on a timer, leave nothing.

import type { JobAction } from "../../queue/queue.ts";

/** POSTs that only read, or that a page sends by itself on a timer. */
const QUIET = [
  /^\/api\/queue\/projects\/[^/]+\/drift$/,
  /^\/api\/queue\/projects\/test-command$/,
  /^\/api\/aide-run$/,
];

export interface ActionSink {
  log: (line: string) => void;
  noteOnJob: (id: string, entry: JobAction) => void;
}

/** The device a user agent names, or its first word. */
function device(agent: string): string {
  for (const name of ["iPhone", "iPad", "Android", "Macintosh", "Windows", "Linux"]) if (agent.includes(name)) return name === "Macintosh" ? "Mac" : name;
  return agent.split(" ")[0] ?? "";
}

/** Who sent a request, as far as the request says: the tailnet login and
 *  address a `tailscale serve` proxy adds, or "local" without them, and
 *  the device its browser names. */
export function requestSource(req: Request): string {
  const login = req.headers.get("tailscale-user-login");
  const address = req.headers.get("x-forwarded-for");
  const agent = device(req.headers.get("user-agent") ?? "");
  return [login ?? "local", address ? `at ${address}` : "", agent ? `(${agent})` : ""].filter(Boolean).join(" ");
}

/** The action a path names: its last part, or the whole path for `/api/queue`. */
const actionOf = (path: string): string => path.split("/").filter(Boolean).at(-1) === "queue" ? "run" : path.split("/").filter(Boolean).at(-1)!;

export async function logAction(sink: ActionSink, req: Request, path: string, response: Response): Promise<void> {
  if (req.method !== "POST" || response.status >= 400 || QUIET.some((quiet) => quiet.test(path))) return;
  let job: { id?: string; project?: string; specFolder?: string } | undefined;
  if (response.headers.get("content-type")?.includes("json")) {
    try {
      job = ((await response.clone().json()) as { job?: typeof job }).job;
    } catch {
      // an answer that is not the JSON it says it is names no job
    }
  }
  const from = requestSource(req);
  const named = job?.id ? ` — job ${job.id.slice(0, 8)}${job.project ? ` (${job.project}/${job.specFolder})` : ""}` : "";
  sink.log(`queue: POST ${path} from ${from}${named}`);
  if (job?.id) sink.noteOnJob(job.id, { at: new Date().toISOString(), action: actionOf(path), from });
}
