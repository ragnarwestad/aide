// Whether Tailscale currently exposes one of the test-server pool's
// ports on this host (spec 491) — asked of `tailscale serve status
// --json`, the live half of the rules docs/tailscale.md has the user
// set up by hand, once, when they want HTTPS. The pool can grow, or a
// host's tailnet rules can be reset, without every host's `tailscale
// serve` state growing or resetting with it — this is what
// `startTestServer` asks before it hands a picked port to a new board,
// so an unexposed port is refused instead of silently serving a board
// nobody off this host can ever reach.

import { TEST_SERVER_PORTS } from "./lifecycle.ts";

// Where the macOS app puts its CLI, for a server whose PATH has no
// `tailscale` on it (launchd's does not).
const DEFAULT_TAILSCALE_BIN = "/usr/local/bin/tailscale";

function output(cmd: string[]): { ok: boolean; stdout: string } {
  try {
    const proc = Bun.spawnSync(cmd);
    return { ok: proc.exitCode === 0, stdout: new TextDecoder().decode(proc.stdout) };
  } catch {
    return { ok: false, stdout: "" };
  }
}

/** The ports a `tailscale serve status --json` answer says are exposed
 *  right now — pure, so it is unit-tested against literal JSON strings,
 *  never a spawned process. `undefined` for anything this function does
 *  not recognize as tailscale's own shape (missing "TCP", not an
 *  object, malformed JSON) — read the same as "cannot tell", never as
 *  "nothing is exposed" (an empty `{"TCP":{}}` IS that answer, and
 *  parses to an empty, defined Set). */
export function parseExposedPorts(json: string): Set<number> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  const tcp = (parsed as { TCP?: unknown }).TCP;
  if (!tcp || typeof tcp !== "object") return undefined;
  const ports = Object.keys(tcp).map(Number).filter((n) => Number.isInteger(n));
  return new Set(ports);
}

/** `undefined` when there is no Tailscale on this host at all (AC-3):
 *  the command could not run, or exited non-zero. A defined, possibly
 *  empty Set is Tailscale's own live answer. */
function exposedPorts(bin: string): Set<number> | undefined {
  const { ok, stdout } = output([bin, "serve", "status", "--json"]);
  return ok ? parseExposedPorts(stdout) : undefined;
}

/** Whether Tailscale exposes `port` on this host right now. `undefined`
 *  is "cannot tell" (no Tailscale here, or its answer did not parse) —
 *  `startTestServer` reads that as AC-3's own "start as before". */
export async function portExposed(
  port: number,
  bin: string = Bun.which("tailscale") ?? DEFAULT_TAILSCALE_BIN,
): Promise<boolean | undefined> {
  return exposureOf(port, exposedPorts(bin));
}

/** Tailscale's answer for one pool port. A host that exposes none of the
 *  pool has not put the test boards behind Tailscale at all — it is an
 *  optional add-on (docs/tailscale.md) — and reads as "cannot tell", so
 *  its boards start as before; only a host that exposes some of the pool
 *  is refused the ports it left out. */
export function exposureOf(
  port: number,
  ports: Set<number> | undefined,
  pool: readonly number[] = TEST_SERVER_PORTS,
): boolean | undefined {
  if (ports === undefined || !pool.some((p) => ports.has(p))) return undefined;
  return ports.has(port);
}
