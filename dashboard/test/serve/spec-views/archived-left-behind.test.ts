// An archived spec whose branch is still on origin is one of two things:
// a landing that never finished (its work is not on the default branch),
// or a merge whose branch delete failed (only a cleanup is left). Git's
// merged answer, peeked from the cache the sweep and the landing keep,
// is what tells them apart — never a job record.

import { describe, expect, test } from "bun:test";
import { archivedSpecRows, type SpecViewsContext } from "../../../src/serve/spec-views";
import type { SpecRef } from "../../../src/project/discover";
import { fakeGit } from "../../helpers/fake-git.ts";

const FOLDER = "300-left-behind";
const KEY = `aide/${FOLDER}`;
const PR_URL = "https://github.com/example/aide/pull/37";

function ctxFor(o: { merged: boolean; closed?: boolean; open?: boolean; reviewing?: boolean }): {
  ctx: SpecViewsContext;
  deleteErrorAsked: string[];
} {
  const deleteErrorAsked: string[] = [];
  const ref = { folder: FOLDER, dir: "/nowhere/archive/300-left-behind", archived: true, closed: o.closed } as unknown as SpecRef;
  const ctx = {
    projectRoot: "/repos",
    targets: () => [],
    peekUnlanded: () => (o.open === false ? [] : [KEY]),
    peekUnlandedCheckedAt: () => 1000,
    readPrOpen: () => (o.reviewing ? [KEY] : []),
    readScan: () => ({ archived: [KEY], refs: new Map([[KEY, ref]]) }),
    queue: {
      list: () => [],
      branchDeleteErrorFor: (_project: string, folder: string) => {
        deleteErrorAsked.push(folder);
        return { key: "landing.branchDeleteFailed", values: {} };
      },
      pullRequestFor: () => ({ prUrl: PR_URL }),
    } as never,
    peekMergedOnOrigin: (project: string, folder: string) => project === "aide" && folder === FOLDER && o.merged,
    specCreatedAt: { peekCreatedAtForArchived: () => ({ createdAt: null }) } as never,
    gitRun: fakeGit({}).run,
  } as unknown as SpecViewsContext;
  return { ctx, deleteErrorAsked };
}

describe("an archived spec whose branch is still on origin", () => {
  test("merged: left behind, not 'not landed', and not built for the Active filter (AC-1)", () => {
    const { ctx } = ctxFor({ merged: true });
    const [row] = archivedSpecRows(ctx, "archived");
    expect(row?.branchLeftBehind).toBe(true);
    expect(row?.notLanded).toBe(false);
    expect(archivedSpecRows(ctx, "not-archived")).toEqual([]);
    expect(archivedSpecRows(ctx, "failed")).toEqual([]);
  });

  test("not merged, or never asked: not landed, built for the Active filter as today (AC-4)", () => {
    const { ctx } = ctxFor({ merged: false });
    const [row] = archivedSpecRows(ctx, "not-archived");
    expect(row?.folder).toBe(FOLDER);
    expect(row?.notLanded).toBe(true);
    expect(row?.branchLeftBehind).toBeFalsy();
  });

  test("a closed spec's open branch reads as today, merged or not (AC-4)", () => {
    const { ctx, deleteErrorAsked } = ctxFor({ merged: true, closed: true });
    const [row] = archivedSpecRows(ctx, "all");
    expect(row?.notLanded).toBe(true);
    expect(row?.branchLeftBehind).toBeFalsy();
    expect(row?.branchDeleteError).toBeDefined();
    expect(deleteErrorAsked).toEqual([FOLDER]);
  });

  test("a branch that is gone is neither (AC-3)", () => {
    const { ctx } = ctxFor({ merged: true, open: false });
    const [row] = archivedSpecRows(ctx, "all");
    expect(row?.notLanded).toBe(false);
    expect(row?.branchLeftBehind).toBeFalsy();
  });
});

describe("an archived spec of a project that reviews its code", () => {
  test("whose pull request merged is left behind, not waiting on a review (AC-1, AC-4)", () => {
    const { ctx } = ctxFor({ merged: true, reviewing: true });
    const [row] = archivedSpecRows(ctx, "archived");
    expect(row?.branchLeftBehind).toBe(true);
    expect(row?.prOpen).toBe(false);
    expect(row?.prUrl).toBeUndefined();
    expect(row?.notLanded).toBe(false);
  });

  test("whose pull request is still open keeps its review line and link (AC-2)", () => {
    const { ctx } = ctxFor({ merged: false, reviewing: true });
    const [row] = archivedSpecRows(ctx, "archived");
    expect(row?.prOpen).toBe(true);
    expect(row?.prUrl).toBe(PR_URL);
    expect(row?.branchLeftBehind).toBeFalsy();
  });

  test("a closed spec keeps its review line as before (AC-2)", () => {
    const { ctx } = ctxFor({ merged: true, closed: true, reviewing: true });
    const [row] = archivedSpecRows(ctx, "all");
    expect(row?.prOpen).toBe(true);
    expect(row?.branchLeftBehind).toBeFalsy();
  });
});
