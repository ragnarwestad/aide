// The machine's own Tailscale name: parsed from `tailscale status --json`,
// looked up lazily, one lookup at a time, retried after a failure.
import { describe, expect, test } from "bun:test";
import { createHostAllowlist, parseSelfDnsName } from "../../../src/serve/serve-helpers";

describe("parseSelfDnsName", () => {
  test("drops the trailing dot and lower-cases", () => {
    expect(parseSelfDnsName({ Self: { DNSName: "RW-MacMini.tail1234.ts.net." } })).toBe("rw-macmini.tail1234.ts.net");
  });

  test("anything else is undefined", () => {
    for (const bad of [null, undefined, 1, "x", {}, { Self: null }, { Self: { DNSName: "" } }, { Self: { DNSName: 4 } }, { Self: { DNSName: "." } }]) {
      expect(parseSelfDnsName(bad)).toBeUndefined();
    }
  });
});

describe("createHostAllowlist (AC-3)", () => {
  const NAME = "rw-macmini.tail1234.ts.net";

  test("loopback names and `extra` answer at once, without a lookup", async () => {
    let calls = 0;
    const hosts = createHostAllowlist({ extra: ["Board.Example.com"], lookup: async () => { calls++; return NAME; } });
    for (const n of ["localhost", "127.0.0.1", "[::1]", "board.example.com"]) expect(await hosts.has(n)).toBe(true);
    expect(calls).toBe(0);
  });

  test("the looked-up name is admitted; siblings and prefixed names are not", async () => {
    const hosts = createHostAllowlist({ extra: [], lookup: async () => NAME });
    expect(await hosts.has(NAME)).toBe(true);
    expect(await hosts.has("other.tail1234.ts.net")).toBe(false);
    expect(await hosts.has(`evil.${NAME}`)).toBe(false);
  });

  test("a success is never asked for again", async () => {
    let calls = 0;
    const hosts = createHostAllowlist({ extra: [], lookup: async () => { calls++; return NAME; } });
    await hosts.has(NAME);
    await hosts.has("x.example");
    await hosts.has(NAME);
    expect(calls).toBe(1);
  });

  test("concurrent callers wait for the one lookup in flight", async () => {
    let calls = 0;
    let release: (n: string) => void = () => {};
    const hosts = createHostAllowlist({
      extra: [],
      lookup: () => {
        calls++;
        return new Promise<string>((r) => (release = r));
      },
    });
    // Not awaited one by one: the three calls must be in flight together.
    // noinspection ES6MissingAwait
    const all = [hosts.has(NAME), hosts.has(NAME), hosts.has("other.example")];
    release(NAME);
    expect(await Promise.all(all)).toEqual([true, true, false]);
    expect(calls).toBe(1);
  });

  test("a failure is retried only after retryMs", async () => {
    let clock = 1000;
    const answers: (string | undefined)[] = [undefined, NAME];
    let calls = 0;
    const hosts = createHostAllowlist({
      extra: [],
      retryMs: 30_000,
      now: () => clock,
      lookup: async () => {
        calls++;
        return answers.shift();
      },
    });
    expect(await hosts.has(NAME)).toBe(false);
    clock += 10_000;
    expect(await hosts.has(NAME)).toBe(false);
    expect(calls).toBe(1);
    clock += 30_000;
    expect(await hosts.has(NAME)).toBe(true);
    expect(calls).toBe(2);
  });

  test("a lookup that throws counts as a failure", async () => {
    const hosts = createHostAllowlist({ extra: [], lookup: async () => { throw new Error("no tailscale"); } });
    expect(await hosts.has(NAME)).toBe(false);
  });
});
