// A create job that was cancelled before its spec landed leaves nothing
// on disk and nothing to press — its row goes with it (2026-09-10). Until
// then the row outlived the spec it named, and the only way to clear it
// was to cut the job out of the queue file by hand. A create that ENDED
// without a spec (failed, stopped, interrupted, or its own merge failed)
// has no row either, in any project: the Specs list draws a message for
// it (`failed-create-notices.ts`).
import { describe, expect, test } from "bun:test";
import { groupBySpec } from "../../../../src/render/pages/specs-list/data-model";
import { row } from "../fixtures.ts";

const targets = [{ project: "aide", specFolder: "81-a-known-spec" }];

describe("a cancelled create job without a folder has no row", () => {
  test("cancelled, folder never landed: no row", () => {
    const groups = groupBySpec(
      [row({ specFolder: "new-abc123de", steps: ["create"], stepIndex: 0, state: "cancelled", createTitle: "Layout" })],
      targets,
    );
    expect(groups.map((g) => g.specFolder)).not.toContain("new-abc123de");
  });

  test("cancelled, but the folder DID land: the row stays, as the folder's own", () => {
    const groups = groupBySpec(
      [row({ specFolder: "81-a-known-spec", steps: ["create"], stepIndex: 0, state: "cancelled" })],
      targets,
    );
    expect(groups.map((g) => g.specFolder)).toContain("81-a-known-spec");
  });

  const key = "new-abc123de";
  const create = (over: Record<string, unknown>) =>
    row({ specFolder: key, steps: ["create"], stepIndex: 0, createTitle: "Layout", ...over });

  // AC-1: with known targets, and in a project the list knows no spec of.
  for (const [name, list] of [["known targets", targets], ["no targets", [] as typeof targets]] as const) {
    test.each(["failed", "stopped", "interrupted"] as const)(`%s: no row (${name})`, (state) => {
      const groups = groupBySpec([create({ state })], list);
      expect(groups.map((g) => g.specFolder)).not.toContain(key);
    });

    test(`queued with a landingError (its own merge failed): no row (${name})`, () => {
      const groups = groupBySpec([create({ state: "queued", landingError: "cannot fast-forward" })], list);
      expect(groups.map((g) => g.specFolder)).not.toContain(key);
    });

    test(`queued, running, or with a merge under way: the row stays (${name})`, () => {
      for (const over of [{ state: "queued" }, { state: "running" }, { state: "stopped", landing: true }]) {
        expect(groupBySpec([create(over)], list).map((g) => g.specFolder)).toContain(key);
      }
    });
  }

  test("running, folder never landed: the row stays", () => {
    const groups = groupBySpec(
      [row({ specFolder: "new-abc123de", steps: ["create"], stepIndex: 0, state: "running", createTitle: "Layout" })],
      targets,
    );
    expect(groups.map((g) => g.specFolder)).toContain("new-abc123de");
  });
});
