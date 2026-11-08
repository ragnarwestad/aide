// The jobs a spec's row is drawn from, the one rule the Specs list and the
// Jobs tab share: a Close or Reopen the Jobs tab draws as a row of its own
// never speaks for its spec on either page.

import { describe, expect, test } from "bun:test";
import type { JobLike } from "../../../../src/render/pages/jobs-page/rows.ts";
import { listedSpecJobs } from "../../../../src/serve/routes/page-routes/spec-row-options.ts";

const ctx = { allowed: new Set(["aide"]) };
const job = (id: string, steps: string[], state: JobLike["state"], createdAt: string): JobLike => ({
  id, project: "aide", specFolder: "01-x", steps, stepIndex: 0, state, createdAt,
});

describe("listedSpecJobs", () => {
  const analyze = job("a", ["analyze", "implement"], "cancelled", "2026-10-14T19:47:00Z");

  test("a failed Close is left to its own row, not its spec's", () => {
    const close = job("c", ["close"], "failed", "2026-10-14T19:48:00Z");
    expect(listedSpecJobs(ctx, [analyze, close]).map((j) => j.id)).toEqual(["a"]);
  });

  test("a Close in flight is left to its own row as well", () => {
    const close = job("c", ["close"], "running", "2026-10-14T19:48:00Z");
    expect(listedSpecJobs(ctx, [analyze, close]).map((j) => j.id)).toEqual(["a"]);
  });

  test("a Close that has no row of its own any more is the spec's again", () => {
    const close = job("c", ["close"], "failed", "2026-10-14T19:48:00Z");
    const later = job("b", ["analyze"], "done", "2026-10-14T19:50:00Z");
    expect(listedSpecJobs(ctx, [analyze, close, later]).map((j) => j.id)).toEqual(["a", "c", "b"]);
  });
});
