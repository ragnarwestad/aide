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

// --- the acceptance criteria checks level is chosen at create only ------------

describe("a Description Save and the recorded acceptance criteria checks level", () => {
  const described = (line: string, body = "As it was.") =>
    `# Queue and runner - Description\n\n## Tracking info\n\n- **Created:** \`2026-10-03 07:00 UTC\`\n` +
    `${line}\n---\n\n## Description\n\n${body}\n`;
  const STOP = "- **Acceptance criteria checks:** stop";

  const save = async (recorded: string, posted: string) => {
    const { base, dir } = harness.start({ description: recorded, extra: { gitRun: savable("/host") } });
    const res = await answer(await post(base, { text: posted, baseSha: FILE_SHA }));
    return { ...res, onDisk: readFileSync(descriptionPath(dir), "utf-8") };
  };

  test.each([
    ["changed to off", described(STOP), described("- **Acceptance criteria checks:** off")],
    ["removed", described(STOP), described("")],
    ["added where none was recorded", described(""), described(STOP)],
  ])("a save with the line %s is refused, and the file is left as it was (AC-7)", async (_name, recorded, posted) => {
    const { status, body, onDisk } = await save(recorded, posted);
    expect(status).toBe(400);
    expect(body.error).toContain("Acceptance criteria checks");
    expect(onDisk).toBe(recorded);
  });

  test("a save that keeps the line as recorded goes through (AC-7)", async () => {
    const posted = described(STOP, "As it is now.");
    const { status, onDisk } = await save(described(STOP), posted);
    expect(status).toBe(200);
    expect(onDisk).toBe(posted);
  });
});
