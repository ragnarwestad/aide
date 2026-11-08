// Which port a server's log says was taken, so the message can name it
// and whoever holds it. `test_start_failure` in
// core/scripts/lib/run-spec/turn/test-start.sh reads a test run's log the
// same way, and core/tests/fixtures/port-in-use.json pins both.

const PLAYWRIGHT =
  /(https?:\/\/[^ ]+) is already used, make sure that nothing is running on the port\/url/;
const BIND = /EADDRINUSE|bind: address already in use/;
/** A log where tests ran and failed: a port line in it is something a test printed. */
const TESTS_RAN = /^\(fail\)|^FAILED|^ERROR|[0-9]+ failed/m;

/** The port the log says was already in use, or undefined. */
export function portInUse(log: string): number | undefined {
  if (TESTS_RAN.test(log)) return undefined;
  const lines = log.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  for (const line of lines) {
    const m = PLAYWRIGHT.exec(line);
    if (!m) continue;
    const port = /^https?:\/\/[^/:]+:([0-9]+)/.exec(m[1]!)?.[1];
    return port ? Number(port) : m[1]!.startsWith("https://") ? 443 : 80;
  }
  for (const line of lines) {
    if (!BIND.test(line)) continue;
    const ports = line.match(/:[0-9]+/g);
    if (ports) return Number(ports[ports.length - 1]!.slice(1));
  }
  return undefined;
}
