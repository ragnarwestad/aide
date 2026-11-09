import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPathInside, sameRepositoryPath } from "../../src/git/real-path.ts";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

test("repository identity resolves symbolic links before comparison (AC-5)", () => {
  const root = mkdtempSync(join(tmpdir(), "aide-real-path-"));
  dirs.push(root);
  const physical = join(root, "physical");
  mkdirSync(join(physical, "child"), { recursive: true });
  const linked = join(root, "linked");
  symlinkSync(physical, linked);
  expect(sameRepositoryPath(linked, physical)).toBe(true);
  expect(isPathInside(join(linked, "child"), physical)).toBe(true);
});
