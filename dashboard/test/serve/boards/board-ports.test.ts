// A board on a port nobody exposed is reachable from the serving host
// and nowhere else — and the reader who wants to look at a branch is
// usually not sitting at it. The pool is three ports put behind
// `tailscale serve` once, by hand, so a board that takes one is
// reachable the moment it is up.

import { describe, expect, test } from "bun:test";
import { BOARD_PORTS, findFreePort } from "../../../src/serve/boards/lifecycle.ts";

// Nothing is bound: a board actually running on this machine must not
// decide what these tests say.
const free = () => true;

describe("a test server takes a port that is actually exposed", () => {
  test("the pool is a small, fixed set", () => {
    expect(BOARD_PORTS.length).toBe(3);
    for (const p of BOARD_PORTS) expect(p).toBeGreaterThan(1024);
    expect(new Set(BOARD_PORTS).size).toBe(BOARD_PORTS.length);
  });

  test("the first free port in the pool is taken, in order", async () => {
    expect(await findFreePort([], free)).toBe(BOARD_PORTS[0]);
    expect(await findFreePort([BOARD_PORTS[0]!], free)).toBe(BOARD_PORTS[1]);
    expect(await findFreePort([BOARD_PORTS[0]!, BOARD_PORTS[1]!], free)).toBe(BOARD_PORTS[2]);
  });

  // Better than a board nobody can open: the reader is told to stop one.
  test("a full pool refuses, and names the ports", async () => {
    await expect(findFreePort([...BOARD_PORTS], free)).rejects.toThrow(/every test-server port is in use/);
  });

  // The port a random pick would have given is never exposed, so it is
  // never chosen either.
  test("nothing outside the pool is ever returned", async () => {
    for (const reserved of [[], [BOARD_PORTS[0]!], [BOARD_PORTS[0]!, BOARD_PORTS[2]!]]) {
      // `BOARD_PORTS` is a literal tuple, so its own `toContain` would
      // only accept one of its three members — this asks the question
      // of a plain array instead.
      expect([...BOARD_PORTS] as number[]).toContain(await findFreePort(reserved, free));
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

  test("all three taken refuses, whoever is holding them", async () => {
    await expect(findFreePort([], () => false)).rejects.toThrow(/every test-server port is in use/);
  });
});

