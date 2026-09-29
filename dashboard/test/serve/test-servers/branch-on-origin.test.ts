// `codeBranchOnOrigin`: the specs list's one answer to "does origin hold this
// spec's branch in the project's code checkout", read from the cache.

import { describe, expect, test } from "bun:test";
import { codeBranchOnOrigin } from "../../../src/serve/test-servers/branch-on-origin.ts";

const CODE = "/checkouts/aide";

/** A cache that holds `open` for `root` only, and has never been asked about any other. */
const cacheFor = (root: string, open: string[] | null) => ({
  peekOpenSpecBranches: (asked: string) =>
    asked === root && open ? { open: new Set(open), checkedAt: 1 } : { open: null, checkedAt: null },
});

describe("codeBranchOnOrigin", () => {
  test("is true for the spec's branch in the code checkout's set (AC-2)", () => {
    expect(codeBranchOnOrigin(cacheFor(CODE, ["aide/562-x"]), CODE, "562-x")).toBe(true);
  });

  test("is false when the set holds other branches but not the spec's (AC-1)", () => {
    expect(codeBranchOnOrigin(cacheFor(CODE, ["aide/563-y"]), CODE, "562-x")).toBe(false);
  });

  test("is false for a set held for another checkout (AC-1)", () => {
    expect(codeBranchOnOrigin(cacheFor("/checkouts/specs", ["aide/562-x"]), CODE, "562-x")).toBe(false);
  });

  test("is false for a checkout origin has never been asked about (AC-1)", () => {
    expect(codeBranchOnOrigin(cacheFor(CODE, null), CODE, "562-x")).toBe(false);
  });
});
