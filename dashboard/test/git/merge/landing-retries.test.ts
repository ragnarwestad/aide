// How often a landing repeats the whole per-root operation after a
// refusal, read from the one place every landing retry is bounded.

import { describe, expect, test } from "bun:test";
import { LANDING_RETRIES, landingRepeats, type RepoMergeResult } from "../../../src/git/branch-merge/index.ts";

const refused = (reason: RepoMergeResult["reason"]): RepoMergeResult => ({ ok: false, root: "/repo", reason, error: "refused" });

describe("the per-root repeat after a refusal", () => {
  test("a folder landed alone is repeated twice (AC-3)", () => {
    expect(landingRepeats(refused("conflict"), true)).toBe(2);
    expect(LANDING_RETRIES.repeats.specFolderOnly).toBe(2);
  });

  test("a number that could not be assigned is repeated once, read from the reason and not the sentence (AC-3)", () => {
    expect(landingRepeats({ ok: false, root: "/repo", reason: "create-number", error: "changed words" }, false)).toBe(1);
    expect(landingRepeats({ ok: false, root: "/repo", error: { key: "landing.createAssignNumberFailed" } }, false)).toBe(0);
  });

  test("any other refusal is not repeated (AC-3)", () => {
    expect(landingRepeats(refused("conflict"), false)).toBe(0);
    expect(landingRepeats({ ok: false, root: "/repo", error: "push refused" }, false)).toBe(0);
  });

  test("a merge that worked is not repeated (AC-3)", () => {
    expect(landingRepeats({ ok: true, root: "/repo" }, false)).toBe(0);
  });
});
