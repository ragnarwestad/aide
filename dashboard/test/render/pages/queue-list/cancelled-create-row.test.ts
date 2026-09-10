// A create job that was cancelled before its spec landed leaves nothing
// on disk and nothing to press — its row goes with it (2026-09-10). Until
// then the row outlived the spec it named, and the only way to clear it
// was to cut the job out of the queue file by hand. A create that FAILED
// keeps its row: the reader re-runs it from there.
import { describe, expect, test } from "bun:test";
import { groupBySpec } from "../../../../src/render/pages/queue-list/data-model.ts";
import { row } from "../fixtures.ts";

const targets = [{ project: "aide", specFolder: "81-a-known-spec" }];

describe("a cancelled create job without a folder has no row", () => {
  test("cancelled, folder never landed: no row", () => {
    const groups = groupBySpec(
      [row({ specFolder: "new-abc123", steps: ["create"], stepIndex: 0, state: "cancelled", createTitle: "Layout" })],
      targets,
    );
    expect(groups.map((g) => g.specFolder)).not.toContain("new-abc123");
  });

  test("cancelled, but the folder DID land: the row stays, as the folder's own", () => {
    const groups = groupBySpec(
      [row({ specFolder: "81-a-known-spec", steps: ["create"], stepIndex: 0, state: "cancelled" })],
      targets,
    );
    expect(groups.map((g) => g.specFolder)).toContain("81-a-known-spec");
  });

  test("failed, folder never landed: the row stays so it can be run again", () => {
    const groups = groupBySpec(
      [row({ specFolder: "new-abc123", steps: ["create"], stepIndex: 0, state: "failed", createTitle: "Layout" })],
      targets,
    );
    expect(groups.map((g) => g.specFolder)).toContain("new-abc123");
  });

  test("running, folder never landed: the row stays", () => {
    const groups = groupBySpec(
      [row({ specFolder: "new-abc123", steps: ["create"], stepIndex: 0, state: "running", createTitle: "Layout" })],
      targets,
    );
    expect(groups.map((g) => g.specFolder)).toContain("new-abc123");
  });
});
