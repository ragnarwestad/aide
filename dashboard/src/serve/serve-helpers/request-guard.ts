// The dashboard's one admission rule, in front of every route: a Host that is
// one of its own, and — for a request that changes something — an Origin that
// equals its own Host. A header that is absent passes (curl, the emitter and
// the round script send none). The rule stops web pages, not another machine:
// every header here is set by the sender.

import type { HostAllowlist } from "./tailscale-name.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const refuse = (why: string): Response =>
  new Response(`forbidden: ${why}\n`, { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });

/** `"[::1]:8788"` -> `"[::1]"`; `undefined` for an empty or malformed value. */
function hostName(host: string): string | undefined {
  const m = host.match(/^(\[[0-9a-f:.]+\]|[^:/\s@\[\]]+)(?::\d*)?$/);
  return m?.[1] || undefined;
}

/** `new URL(origin).host`, lower-cased; `""` when it does not parse (`null`
 *  included), so it never equals a Host. */
function originHost(origin: string): string {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return "";
  }
}

/** A method that is not safe, or the one GET that starts a test board. */
function changesSomething(req: Request): boolean {
  if (!SAFE_METHODS.has(req.method)) return true;
  try {
    return req.method === "GET" && new URL(req.url, "http://localhost").searchParams.get("startTestServer") === "1";
  } catch {
    return false;
  }
}

/** `null` admits the request; a 403 refuses it. Runs before `new URL(req.url)`
 *  anywhere else: a request with no Host has a `req.url` that does not parse. */
export async function checkRequest(req: Request, hosts: HostAllowlist): Promise<Response | null> {
  const host = req.headers.get("host")?.toLowerCase();
  const name = host ? hostName(host) : undefined;
  if (!host || !name || !(await hosts.has(name))) {
    return refuse(`this address is not one the dashboard is served at: ${host || "no Host header"}`);
  }
  if (!changesSomething(req)) return null;
  const origin = req.headers.get("origin");
  if (origin !== null && originHost(origin) !== host) return refuse(`a request from another site: Origin ${origin}`);
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") {
    return refuse(`a request from another site: Sec-Fetch-Site ${site}`);
  }
  return null;
}
