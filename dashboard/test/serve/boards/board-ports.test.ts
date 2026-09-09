// A board on a port nobody exposed is reachable from the serving host
// and nowhere else — and the reader who wants to look at a branch is
// usually not sitting at it. The pool is six ports put behind
// `tailscale serve` once, by hand, so a board that takes one is
// reachable the moment it is up.

import { describe, expect, test } from "bun:test";
import { BOARD_PORTS, findFreePort } from "../../../src/serve/boards/lifecycle.ts";

// Nothing is bound: a board actually running on this machine must not
// decide what these tests say.
const free = () => true;

describe("a test server takes a port that is actually exposed", () => {
  test("the pool is a small, fixed set", () => {
    expect(BOARD_PORTS.length).toBe(6);
    for (const p of BOARD_PORTS) expect(p).toBeGreaterThan(1024);
    expect(new Set(BOARD_PORTS).size).toBe(BOARD_PORTS.length);
  });

  test("the first free port in the pool is taken, in order", async () => {
    const reserved: number[] = [];
    for (const port of BOARD_PORTS) {
      expect(await findFreePort(reserved, free)).toBe(port);
      reserved.push(port);
    }
  });

  // REQ-1/REQ-2: a full pool no longer throws — `startBoard()` turns
  // an absent port into its own `{ ok: false, error }` refusal, stating
  // how many test servers are running and what the limit is
  // (`lifecycle.test.ts`); `findFreePort()` itself just reports "none
  // free".
  test("a full pool returns no port", async () => {
    expect(await findFreePort([...BOARD_PORTS], free)).toBeUndefined();
  });

  // The port a random pick would have given is never exposed, so it is
  // never chosen either.
  test("nothing outside the pool is ever returned", async () => {
    for (const reserved of [[], [BOARD_PORTS[0]!], [BOARD_PORTS[0]!, BOARD_PORTS[2]!]]) {
      const port = await findFreePort(reserved, free);
      expect(port).toBeDefined();
      // `BOARD_PORTS` is a literal tuple, so its own `toContain` would
      // only accept one of its six members — this asks the question of
      // a plain array instead.
      expect([...BOARD_PORTS] as number[]).toContain(port!);
    }
  });
});

// And the probe is asked, not assumed: a port something else already
// holds is skipped, which is the whole reason the pool is probed at all.
describe("a port in the pool that is already taken", () => {
  test("is skipped, and the next free one is used", async () => {
    const busy = new Set<number>([BOARD_PORTS[0]!]);
    expect(await findFreePort([], (p) => !busy.has(p))).toBe(BOARD_PORTS[1]);
  });

  test("all taken returns no port, whoever is holding them", async () => {
    expect(await findFreePort([], () => false)).toBeUndefined();
  });
});

