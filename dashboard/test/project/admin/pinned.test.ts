// A project's Pin: kept beside the board's checkouts of the project, and the
// order every project list draws in, pinned ones first.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPinned, pinnedFirst, pinnedOf, setPinned } from "../../../src/project/project-admin/pinned.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
const base = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "aide-pinned-"));
  dirs.push(dir);
  return dir;
};

describe("a project's Pin", () => {
  test("is on once set, off once cleared, and clearing it twice is no error (AC-4)", () => {
    const b = base();
    expect(isPinned(b, "aide")).toBe(false);
    setPinned(b, "aide", true);
    expect(isPinned(b, "aide")).toBe(true);
    setPinned(b, "aide", false);
    expect(isPinned(b, "aide")).toBe(false);
    setPinned(b, "aide", false);
    expect(isPinned(b, "aide")).toBe(false);
  });

  test("is kept under the base it is given, beside that project's checkouts (AC-5)", () => {
    const b = base();
    setPinned(b, "aide", true);
    expect(existsSync(join(b, "aide", "pinned"))).toBe(true);
  });

  test("reads as off for a base that is not there", () => {
    expect(isPinned(join(tmpdir(), "aide-pinned-no-such-base"), "aide")).toBe(false);
  });

  test("pinnedOf names the pinned ones among the projects asked about", () => {
    const b = base();
    setPinned(b, "beta", true);
    setPinned(b, "other", true);
    expect([...pinnedOf(b, ["alpha", "beta", "gamma"])]).toEqual(["beta"]);
  });
});

describe("pinned first", () => {
  const name = (p: string): string => p;

  test("puts the pinned ones first, each group in the order the list had (AC-3)", () => {
    const pinned = new Set(["beta", "delta"]);
    expect(pinnedFirst(["alpha", "beta", "delta", "gamma"], pinned, name)).toEqual(["beta", "delta", "alpha", "gamma"]);
    expect(pinnedFirst(["gamma", "delta", "alpha", "beta"], pinned, name)).toEqual(["delta", "beta", "gamma", "alpha"]);
  });

  test("with nothing pinned, the list is as it was, and the input is left alone (AC-4)", () => {
    const list = ["gamma", "alpha"];
    expect(pinnedFirst(list, new Set(), name)).toEqual(["gamma", "alpha"]);
    pinnedFirst(list, new Set(["alpha"]), name);
    expect(list).toEqual(["gamma", "alpha"]);
  });
});
