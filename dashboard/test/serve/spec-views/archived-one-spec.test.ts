import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as coverage from "../../../src/project/ac-coverage.ts";
// The archived rows for the keys it is given alone: a request for one row
// reads one archived spec, and nothing for any other.

import { describe, expect, test, spyOn } from "bun:test";
import { archivedSpecRows, type SpecViewsContext } from "../../../src/serve/spec-views";
import type { SpecRef } from "../../../src/project/discover";
import { fakeGit } from "../../helpers/fake-git.ts";

const FOLDERS = ["300-first", "301-second", "302-third"];
const keyOf = (folder: string): string => `aide/${folder}`;

/** A context holding three archived specs, and the folders whose created date was peeked. */
function archive(): { ctx: SpecViewsContext; peeked: string[] } {
  const peeked: string[] = [];
  const refs = new Map(FOLDERS.map((folder) => [
    keyOf(folder),
    { folder, dir: `/nowhere/archive/${folder}`, archived: true, title: folder } as unknown as SpecRef,
  ]));
  const ctx = {
    projectRoot: "/repos",
    targets: () => [],
    peekUnlanded: () => [],
    peekUnlandedCheckedAt: () => 1000,
    readPrOpen: () => [],
    readScan: () => ({ archived: FOLDERS.map(keyOf), refs }),
    queue: { list: () => [], branchDeleteErrorFor: () => undefined, pullRequestFor: () => ({}) } as never,
    peekMergedOnOrigin: () => false,
    specCreatedAt: {
      peekCreatedAtForArchived: (_dir: string, folder: string) => {
        peeked.push(folder);
        return { createdAt: null };
      },
    } as never,
    gitRun: fakeGit({}).run,
  } as unknown as SpecViewsContext;
  return { ctx, peeked };
}

describe("archivedSpecRows given the keys to read", () => {
  test("answers that spec's row, as the whole answer has it, and reads no other spec (AC-3)", () => {
    const whole = archivedSpecRows(archive().ctx, "all");
    expect(whole.map((row) => row.folder)).toEqual(FOLDERS);

    const { ctx, peeked } = archive();
    const one = archivedSpecRows(ctx, "all", new Set([keyOf("301-second")]));
    expect(one).toEqual([whole[1]!]);
    expect(peeked).toEqual(["301-second"]);
  });

  test("an empty set of keys answers no row and reads nothing (AC-3)", () => {
    const { ctx, peeked } = archive();
    expect(archivedSpecRows(ctx, "all", new Set())).toEqual([]);
    expect(peeked).toEqual([]);
  });
});

test("cold and warm archive summaries leave acceptance detail to selected keys and invalidate changed aggregates (AC-10)", () => {
  const dir = mkdtempSync(join(tmpdir(), "archive-summary-"));
  const { ctx } = archive();
  const scan = ctx.readScan()!;
  for (const ref of scan.refs.values()) {
    ref.dir = join(dir, ref.folder);
    ref.notVerified = 1;
    mkdirSync(ref.dir);
    writeFileSync(join(ref.dir, "4-status.md"), "# Status\n\n## Tracking info\n\n- **Workflow steps completed:** create, analyze\n");
    writeFileSync(join(ref.dir, "3-solution.md"), "# Solution\n\n## Tracking info\n\n- **Time spent:** 1m00s\n- **Cost:** $1\n");
  }
  const read = spyOn(coverage, "readAcCoverage");
  try {
    const cold = archivedSpecRows(ctx, "all", undefined, true);
    const warm = archivedSpecRows(ctx, "all", undefined, true);
    expect(warm).toEqual(cold);
    expect(read).not.toHaveBeenCalled();
    expect(cold[0]!.summaryDuration?.ms).toBe(60000);
    const first = scan.refs.get(keyOf(FOLDERS[0]!))!;
    writeFileSync(join(first.dir, "3-solution.md"), "# Solution\n\n## Tracking info\n\n- **Time spent:** 2m00s\n- **Cost:** $12\n");
    const changed = archivedSpecRows(ctx, "all", undefined, true);
    expect(changed[0]!.phaseOutcomes.implement?.cost).toBe(12);
    expect(changed[0]!.summaryDuration?.ms).toBe(120000);
    expect(changed[1]).toEqual(cold[1]);
    archivedSpecRows(ctx, "all", new Set([keyOf(FOLDERS[0]!)]));
    expect(read).toHaveBeenCalledTimes(1);
  } finally { read.mockRestore(); rmSync(dir, { recursive: true, force: true }); }
});
