// A project's Hide: kept beside the board's checkouts of the project, never
// inside either clone.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hiddenOf, isHidden, setHidden } from "../../../../src/project/project-admin/hidden.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
const base = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "aide-hidden-"));
  dirs.push(dir);
  return dir;
};

describe("a project's Hide", () => {
  test("is on once set, off once cleared, and kept only under the base it is given (AC-10)", () => {
    const b = base();
    expect(isHidden(b, "aide")).toBe(false);
    setHidden(b, "aide", true);
    expect(isHidden(b, "aide")).toBe(true);
    expect(existsSync(join(b, "aide", "hidden"))).toBe(true);
    setHidden(b, "aide", false);
    expect(isHidden(b, "aide")).toBe(false);
    expect(existsSync(join(b, "aide", "hidden"))).toBe(false);
    setHidden(b, "aide", false);
    expect(isHidden(b, "aide")).toBe(false);
  });

  test("reads as shown for a base that is not there", () => {
    expect(isHidden(join(tmpdir(), "aide-hidden-no-such-base"), "aide")).toBe(false);
  });

  test("hiddenOf names the hidden ones among the projects asked about", () => {
    const b = base();
    setHidden(b, "beta", true);
    setHidden(b, "other", true);
    expect([...hiddenOf(b, ["alpha", "beta", "gamma"])]).toEqual(["beta"]);
  });
});
