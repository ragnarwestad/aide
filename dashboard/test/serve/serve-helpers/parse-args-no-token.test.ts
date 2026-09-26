import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../../../src/serve/serve-helpers";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
const configFile = (contents: Record<string, unknown>): string => {
  const dir = mkdtempSync(join(tmpdir(), "aide-no-token-"));
  dirs.push(dir);
  const file = join(dir, "queue-config.json");
  writeFileSync(file, JSON.stringify(contents));
  return file;
};

describe("--token-file (AC-4)", () => {
  test("is an unknown argument", () => {
    expect(() => parseArgs(["--token-file", "x"])).toThrow("unknown argument: --token-file");
  });
});

describe("allowedHosts in queue-config.json (AC-3)", () => {
  test("a list of names is read, lower-cased", () => {
    const opts = parseArgs(["--queue-config", configFile({ allowedHosts: ["Board.Example.com", "b.example"] })]);
    expect(opts.allowedHosts).toEqual(["board.example.com", "b.example"]);
  });

  test("a malformed value is ignored with one message", () => {
    const seen: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void seen.push(a.join(" "));
    try {
      for (const allowedHosts of ["board.example.com", [1], [""], { a: 1 }, ["a b"], ["a/b"]]) {
        seen.length = 0;
        const opts = parseArgs(["--queue-config", configFile({ allowedHosts })]);
        expect(opts.allowedHosts).toBeUndefined();
        expect(seen.length).toBe(1);
      }
    } finally {
      console.error = orig;
    }
  });

  test("no key leaves it unset", () => {
    expect(parseArgs(["--queue-config", configFile({ concurrency: 2 })]).allowedHosts).toBeUndefined();
  });
});

describe("headerAuth is read as before (AC-6)", () => {
  test("a well-formed block is read; a malformed one is ignored", () => {
    const good = { header: "Tailscale-User-Login", users: ["alice@example.com"] };
    expect(parseArgs(["--queue-config", configFile({ headerAuth: good })]).headerAuth).toEqual(good);
    expect(parseArgs(["--queue-config", configFile({ headerAuth: { header: "", users: ["a"] } })]).headerAuth).toBeUndefined();
  });
});
