// The port a server's log says was taken, read as the runner reads a test
// run's log: core/tests/fixtures/port-in-use.json pins both.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { portInUse } from "../../src/format/port-in-use.ts";

const CASES = JSON.parse(readFileSync(join(import.meta.dir, "../../../core/tests/fixtures/port-in-use.json"), "utf-8"))
  .cases as { name: string; log: string; port: number | null }[];

describe("portInUse", () => {
  for (const c of CASES) {
    test(c.name, () => {
      expect(portInUse(c.log) ?? null).toBe(c.port);
    });
  }
});
