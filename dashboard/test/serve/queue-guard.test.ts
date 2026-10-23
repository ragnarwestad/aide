import { describe, expect, test } from "bun:test";
import { bindWarning, isLoopbackBind } from "../../src/serve/queue-guard.ts";

describe("isLoopbackBind", () => {
  test("no address given is the default, which is loopback (AC-1)", () => {
    expect(isLoopbackBind()).toBe(true);
    expect(isLoopbackBind(undefined)).toBe(true);
  });

  test("127.0.0.1 and ::1 are loopback, any other address is not", () => {
    expect(isLoopbackBind("127.0.0.1")).toBe(true);
    expect(isLoopbackBind("::1")).toBe(true);
    expect(isLoopbackBind("0.0.0.0")).toBe(false);
  });
});

describe("bindWarning", () => {
  test("an address that is not loopback gets a line naming it (AC-4)", () => {
    expect(bindWarning("0.0.0.0")).toContain("0.0.0.0");
    expect(bindWarning("192.168.1.5")).toContain("192.168.1.5");
  });

  test("a loopback address, or none, gets no warning (AC-4)", () => {
    expect(bindWarning("127.0.0.1")).toBeUndefined();
    expect(bindWarning("::1")).toBeUndefined();
    expect(bindWarning(undefined)).toBeUndefined();
  });
});
