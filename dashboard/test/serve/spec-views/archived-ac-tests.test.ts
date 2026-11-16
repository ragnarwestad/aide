// An archived spec's acceptance rows carry the tests implement recorded for
// them, as an open spec's do: whoever checks a Not verified row after the
// archive sees what proves it.

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archivedSpecRows, type SpecViewsContext } from "../../../src/serve/spec-views";
import type { SpecRef } from "../../../src/project/discover";
import { AC_COVERAGE_FILE, STATUS_FILE } from "../../../src/project/spec-names.ts";
import { fakeGit } from "../../helpers/fake-git.ts";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

test("an archived spec's Not verified row carries its recorded tests", () => {
  const dir = mkdtempSync(join(tmpdir(), "aide-archived-ac-tests-"));
  dirs.push(dir);
  writeFileSync(join(dir, STATUS_FILE), [
    "## Acceptance criteria", "",
    "| Task | Status | Notes |", "|------|--------|-------|",
    "| AC-1: WHEN a row opens, the list SHALL show it. | Not verified | |", "",
  ].join("\n"));
  const test1 = { file: "test/rows.test.ts", name: "opens the row (AC-1)" };
  writeFileSync(join(dir, AC_COVERAGE_FILE), JSON.stringify({ acs: { "AC-1": [test1] } }));
  const refs = new Map([["aide/300-done", { folder: "300-done", dir, archived: true, notVerified: 1 } as unknown as SpecRef]]);
  const ctx = {
    projectRoot: "/repos",
    targets: () => [],
    peekUnlanded: () => [],
    peekUnlandedCheckedAt: () => 1000,
    readPrOpen: () => [],
    readScan: () => ({ archived: ["aide/300-done"], refs }),
    queue: { list: () => [], branchDeleteErrorFor: () => undefined, pullRequestFor: () => ({}) } as never,
    peekMergedOnOrigin: () => false,
    specCreatedAt: { peekCreatedAtForArchived: () => ({ createdAt: null }) } as never,
    gitRun: fakeGit({}).run,
  } as unknown as SpecViewsContext;

  const [row] = archivedSpecRows(ctx, "all");
  expect(row!.acceptance?.[0]?.tests).toEqual([test1]);
});
