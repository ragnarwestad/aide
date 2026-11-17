import { expect, test } from "bun:test";
import { repairable, repairLanding } from "../../../../src/serve/land-branch/repair/index.ts";

test("only named failures proved unique to a green main may be repaired", () => {
  const verdict = { ok: false, error: { key: "landing.testsRedOnMerge" as const }, failedTests: [{ name: "rule", file: "test/rule.test.ts", error: "wrong" }] };
  expect(repairable(verdict)).toBe(true);
  expect(repairable({ ...verdict, error: { key: "landing.testsRedOnMainToo" } })).toBe(false);
  expect(repairable({ ...verdict, failedTests: [] })).toBe(false);
  expect(repairable({ ...verdict, terminalReason: "timeout" })).toBe(false);
});

test("two repair rounds rebuild the merge; a third red result stops", async () => {
  let calls = 0;
  const repair = repairLanding(async () => { calls++; return true; });
  const request = { root: "/tmp/tree", branch: "feature", verdict: { ok: false, error: { key: "landing.testsRedOnMerge" as const }, failedTests: [{ name: "rule", file: "rule.test.ts", error: "wrong" }] }, job: { project: "p", specFolder: "s" } };
  expect(await repair(request)).toBe(true);
  expect(await repair(request)).toBe(true);
  expect(await repair(request)).toBe(false);
  expect(calls).toBe(2);
});
