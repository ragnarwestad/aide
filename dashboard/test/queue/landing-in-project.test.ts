// Reset, Close and a test server wait for a landing in their own
// project only. They used to wait for one anywhere on the board, so a
// PaceUp spec's Close was greyed out while an aide archive merged.

import { describe, expect, test } from "bun:test";
import { landingInProject, type Job } from "../../src/queue/queue.ts";

const job = (project: string, landing?: boolean) => ({ project, landing }) as unknown as Job;

describe("a landing under way", () => {
  test("in the same project counts", () => {
    expect(landingInProject([job("paceup", true)], "paceup")).toBe(true);
  });

  test("in another project does not", () => {
    expect(landingInProject([job("aide", true), job("paceup")], "paceup")).toBe(false);
  });
});
