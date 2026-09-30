// Split out of spec-save.test.ts by theme: the edit page's own retired
// address, the ordinary Save path and its refusals, the description's
// size cap, two specs sharing one checkout, and Save against an
// archived spec.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FILE_SHA, DESCRIPTION, NEW_TEXT, createSpecSaveHarness, descriptionPath, post, answer, savable } from "./spec-save-fixtures.ts";
import { statusSaying } from "../helpers/queue-server.ts";

const { harness, start } = createSpecSaveHarness();
afterEach(() => harness.cleanup());

// --- spec 212: the textarea lives on the spec page's own Description tab ----

describe("the Description tab", () => {
  test("a spec nobody has is a 404, not a blank editor", async () => {
    const { base } = start(savable("/host"));
    expect((await fetch(`${base}/specs/aide/99-no-such-spec?tab=description`)).status).toBe(404);
  });
});

// --- spec 471, AC-1 regression lock ------------------------------------
//
// 2-analysis.md's own Codebase analysis found this already true today:
// `descriptionPanel`/`documentPanel` gate read-only status on
// `archived`/`activeJob` alone, and the save route checks no phase at
// all — a held-back spec is neither archived nor busy, so its
// Description tab was never actually locked. Guarded here as a
// regression rather than left as an assumption, the same treatment
// Step 0 already gives AC-7's own "already true" branch-reuse case.

describe("AC-1 (spec 471): a held-back spec's description stays editable", () => {
  test("Save on a spec held back on unticked acceptance criteria is not refused", async () => {
    const heldBackStatus = statusSaying(
      ["create", "analyze", "implement"],
      "\n## Acceptance criteria\n\n| Task | Status | Notes |\n|------|--------|-------|\n" +
        "| AC-1: does the thing | ⬜ | |\n",
    );
    const { base, dir } = harness.start({
      description: DESCRIPTION,
      status: heldBackStatus,
      extra: { gitRun: savable("/host") },
    });
    const { status, body } = await answer(await post(base, { text: NEW_TEXT, baseSha: FILE_SHA }));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(NEW_TEXT);
  });
});
