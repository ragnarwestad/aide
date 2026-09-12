// `process.kill(-1)` reaches every process the user owns — the served
// dashboard, the terminal, the browser, the login session — and a pid
// of 1 in any record this server keeps is one negation away from it.
// `signalGroup` is the one door to a group kill, and it refuses
// anything below 2; the second test here keeps every other file from
// opening a door of its own.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isSignallablePid, signalGroup, signalProcess } from "../../src/serve/serve-helpers/signal-group.ts";

let calls: { pid: number; signal: unknown }[];
let killSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  calls = [];
  killSpy = spyOn(process, "kill").mockImplementation(((pid: number, signal?: unknown) => {
    calls.push({ pid, signal });
    return true;
  }) as typeof process.kill);
});
afterEach(() => killSpy.mockRestore());

describe("signalGroup", () => {
  test("a pid below 2, or no pid at all, is never negated and sent", () => {
    for (const pid of [1, 0, -1, -4242, 1.5, Number.NaN, undefined, null, "4242"]) {
      expect(signalGroup(pid)).toBe(false);
      expect(signalProcess(pid)).toBe(false);
      expect(isSignallablePid(pid)).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  test("a real pid reaches its whole group, with SIGTERM unless told otherwise", () => {
    expect(signalGroup(4242)).toBe(true);
    expect(signalGroup(4243, "SIGKILL")).toBe(true);
    expect(signalProcess(4244)).toBe(true);
    expect(calls).toEqual([
      { pid: -4242, signal: "SIGTERM" },
      { pid: -4243, signal: "SIGKILL" },
      { pid: 4244, signal: "SIGTERM" },
    ]);
  });

  test("a group that is already gone is reported, not thrown", () => {
    killSpy.mockImplementation((() => {
      throw new Error("ESRCH");
    }) as typeof process.kill);
    expect(signalGroup(4242)).toBe(false);
  });
});

/** Every .ts file under src, recursively. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

test("no file under src negates a pid for process.kill except signal-group.ts", () => {
  const root = join(import.meta.dir, "..", "..", "src");
  const offenders = sources(root).filter(
    (path) => !path.endsWith("serve-helpers/signal-group.ts") && /process\.kill\(\s*-/.test(readFileSync(path, "utf8")),
  );
  expect(offenders).toEqual([]);
});
