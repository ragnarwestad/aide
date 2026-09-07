// Spec 387: the round trusts a bare HTTP 200 on its own port as proof the
// board answering is the one it just started — so a port a `--keep`'d
// earlier round still holds gets the new round's fixtures seeded into
// it instead. This spawns the real script against a decoy that answers
// exactly like a kept-alive board would (200 on the health check, 200 on
// create/queue) and proves the round refuses before ever posting to it,
// plus the REQ-4 regression: a free port behaves exactly as before.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";

setDefaultTimeout(20_000);

const AIDE_CHECKOUT = join(import.meta.dir, "..", "..", "..");
const RUN = join(import.meta.dir, "run");

/** A board that answers every request 200, the way a real kept-alive
 *  board would to a round whose own server never got the port. Records
 *  what it was asked, so a refusal can be proven by an EMPTY log rather
 *  than by guessing at timing. */
function decoyBoard() {
  const requests: { method: string; path: string }[] = [];
  const jobs: { id: string; specFolder: string }[] = [];
  let counter = 0;
  const server = Bun.serve({
    port: 0,
    // The round's own server always binds `--bind 127.0.0.1` explicitly
    // (dashboard/test/round/run:146). A wildcard-bound decoy listens
    // ALONGSIDE that instead of colliding with it — both answer, and the
    // "collision" this test means to reproduce never happens — so the
    // decoy has to claim the same specific address, not the default.
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      requests.push({ method: req.method, path: url.pathname });
      if (req.method === "GET" && url.pathname === "/api/queue") return Response.json({ jobs });
      if (req.method === "POST" && url.pathname === "/api/queue/create") {
        counter += 1;
        const id = `decoy-${counter}`;
        jobs.push({ id, specFolder: `decoy-folder-${counter}` });
        return Response.json({ job: { id } });
      }
      return Response.json({ ok: true });
    },
  });
  return { port: server.port, requests, stop: () => server.stop(true) };
}

async function runToExit(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({ cmd: ["/bin/bash", RUN, AIDE_CHECKOUT, ...args], stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe("the round, against a port another board already holds", () => {
  test("REQ-1..REQ-3: refuses before seeding anything on the decoy", async () => {
    const decoy = decoyBoard();
    try {
      const { code, stderr } = await runToExit(["--port", String(decoy.port), "--timeout", "5"]);
      expect(code).not.toBe(0);
      expect(stderr).toContain(String(decoy.port));
      expect(stderr).toMatch(/already.*board/);
      expect(decoy.requests.some((r) => r.method === "POST")).toBe(false);
    } finally {
      decoy.stop();
    }
  });

  test("REQ-2: a refusal with --keep never claims the dead pid is left running", async () => {
    const decoy = decoyBoard();
    try {
      const { stdout } = await runToExit(["--port", String(decoy.port), "--timeout", "5", "--keep"]);
      expect(stdout).not.toContain("left running");
      // The same guarantee for the line the round prints the moment its
      // own server answers: there is no server of ours here to announce.
      expect(stdout).not.toContain("board up");
    } finally {
      decoy.stop();
    }
  });
});

describe("the round, on a port nothing else holds", () => {
  test("REQ-4: reaches the queue step with none of the new refusal text", async () => {
    // A free port, picked the same way the queue-server test helper picks
    // one for its own in-process server: bind to 0, read back what the OS
    // gave, then let go of it for the round's own server to bind instead.
    const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
    const port = probe.port;
    probe.stop(true);

    const proc = Bun.spawn({
      cmd: ["/bin/bash", RUN, AIDE_CHECKOUT, "--port", String(port), "--timeout", "5"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderrDone = new Response(proc.stderr).text();
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";
    while (!stdout.includes("== queue the specs, each through create")) {
      const { value, done } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value);
    }
    reader.releaseLock();
    // trap stop EXIT tears the board and the throwaway directory down
    // the same way a person's Ctrl-C would — no need to wait out the
    // full fixture run to prove REQ-4.
    proc.kill("SIGTERM");
    await proc.exited;
    await stderrDone;

    expect(stdout).toContain("== queue the specs, each through create");
    expect(stdout).not.toContain("already held by another board");
  });
});
