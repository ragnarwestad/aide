// The manifest's `reuse` key names where the board keeps its reusable parts,
// and analyze reads each path before it plans. A path that moves leaves the
// key pointing at nothing, and no run would say so.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const REPO = join(import.meta.dir, "..", "..", "..", "..");

test("every path this repository's reuse key names exists (AC-6)", () => {
  const manifest = parse(readFileSync(join(REPO, ".aide", "project.yaml"), "utf-8")) as Record<string, unknown>;
  const reuse = manifest.reuse;
  expect(Array.isArray(reuse)).toBe(true);
  expect((reuse as unknown[]).length).toBeGreaterThan(0);
  const missing = (reuse as string[]).filter((path) => !existsSync(join(REPO, path)));
  expect(missing).toEqual([]);
});
