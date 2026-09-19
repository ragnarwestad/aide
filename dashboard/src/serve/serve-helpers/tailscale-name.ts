// The machine's own Tailscale name, and the set of host names the dashboard
// answers to. The name is asked for lazily: launchd may start the dashboard
// before `tailscaled` is up, so a lookup at boot could find nothing.

// Matches the Makefile's own `TAILSCALE ?= /usr/local/bin/tailscale` (the same
// hand-paired default `test-servers/tailscale-exposure.ts` keeps).
const DEFAULT_TAILSCALE_BIN = "/usr/local/bin/tailscale";
const LOOKUP_TIMEOUT_MS = 3_000;
const LOOPBACK_NAMES = ["localhost", "127.0.0.1", "[::1]"];

/** `Self.DNSName` from a `tailscale status --json` answer, lower-cased and
 *  without the trailing dot; `undefined` for anything else. */
export function parseSelfDnsName(json: unknown): string | undefined {
  const dns = (json as { Self?: { DNSName?: unknown } } | null | undefined)?.Self?.DNSName;
  if (typeof dns !== "string") return undefined;
  const name = dns.replace(/\.$/, "").toLowerCase();
  return name || undefined;
}

/** Asks the tailscale CLI for this machine's name; `undefined` on any failure. */
export async function lookupTailscaleName(): Promise<string | undefined> {
  try {
    const proc = Bun.spawn([Bun.which("tailscale") ?? DEFAULT_TAILSCALE_BIN, "status", "--json"], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: LOOKUP_TIMEOUT_MS,
    });
    const text = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return undefined;
    return parseSelfDnsName(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export interface HostAllowlist {
  /** Whether `name` (a host name with no port, lower-case) is one of the dashboard's own. */
  has(name: string): Promise<boolean>;
}

/** The loopback names and `extra` answer at once. Any other name asks `lookup`
 *  — one lookup at a time, every concurrent caller awaiting the same promise,
 *  at most once per `retryMs` while it has not answered, and never again once
 *  it has. */
export function createHostAllowlist(o: {
  extra: string[];
  lookup?: () => Promise<string | undefined>;
  now?: () => number;
  retryMs?: number;
}): HostAllowlist {
  const names = new Set<string>([...LOOPBACK_NAMES, ...o.extra.map((n) => n.toLowerCase())]);
  const now = o.now ?? Date.now;
  const retryMs = o.retryMs ?? 30_000;
  let found = false;
  let inFlight: Promise<void> | undefined;
  let lastTry = -Infinity;

  const ask = (): Promise<void> => {
    lastTry = now();
    inFlight = (async () => {
      const name = await o.lookup!().catch(() => undefined);
      if (name) {
        names.add(name);
        found = true;
        console.log(`the dashboard answers to ${name}`);
      }
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };

  return {
    async has(name) {
      if (names.has(name)) return true;
      if (!o.lookup || found) return false;
      if (inFlight) await inFlight;
      else if (now() - lastTry >= retryMs) await ask();
      return names.has(name);
    },
  };
}
