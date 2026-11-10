// What a step's landing does is read from one entry per workflow step,
// never from a step's name tested where the landing happens.

import { describe, expect, test } from "bun:test";
import { LANDING_POLICIES, landingPolicy } from "../../../../src/serve/land-branch/policy/index.ts";
import { WORKFLOW_STEPS } from "../../../../src/queue/steps.ts";
import { read } from "../../../guards/source.ts";

describe("the landing policy table", () => {
  test("has exactly one entry for each workflow step, and names no other (AC-1)", () => {
    expect(Object.keys(LANDING_POLICIES).sort()).toEqual([...WORKFLOW_STEPS].sort());
  });

  test("without a step nothing lands (AC-1)", () => {
    const none = landingPolicy(undefined);
    expect(none.onOk).toBeUndefined();
    expect(none.landsWhenStopped).toBe(false);
  });

  test("a name the table does not hold lands as explore does (AC-1)", () => {
    expect(landingPolicy("no-such-step")).toEqual(LANDING_POLICIES.explore!);
  });

  test("archive lands code first, keeps a pull request open and asks origin afterwards (AC-1)", () => {
    const archive = landingPolicy("archive");
    expect(archive.codeFirst).toBe(true);
    expect(archive.codeRoot).toBe("merge-unless-pr");
    expect(archive.checksOrigin).toBe(true);
    expect(archive.retriesLate).toBe(true);
    expect(archive.keepsFailedTests).toBe(true);
    expect(archive.landsWhenStopped).toBe(false);
  });

  test("close discards the code root and lands the spec's folder alone (AC-1)", () => {
    expect(landingPolicy("close").codeRoot).toBe("discard");
    expect(landingPolicy("close").specFolderOnly).toBe(true);
  });

  test("only the steps that carry no code land the spec's folder alone (AC-1)", () => {
    const folderOnly = WORKFLOW_STEPS.filter((s) => landingPolicy(s).specFolderOnly).sort();
    expect(folderOnly).toEqual(["analyze", "close", "implement", "reopen"]);
  });

  test("schedule lands code first, and only a run that pushed (AC-1)", () => {
    expect(landingPolicy("schedule").codeFirst).toBe(true);
    expect(landingPolicy("schedule").onOk?.onlyWhenPushed).toBe(true);
  });

  test("create alone numbers the spec (AC-1)", () => {
    expect(WORKFLOW_STEPS.filter((s) => landingPolicy(s).numbersSpec)).toEqual(["create"]);
  });

  test("implement lands past the code root only when it was sent back (AC-1)", () => {
    expect(landingPolicy("implement").onOk).toBeUndefined();
    expect(landingPolicy("implement").stoppedPastCode).toEqual(["sent-back"]);
  });
});

describe("the landing decides by the policy, never by a step's name", () => {
  const names = WORKFLOW_STEPS.map((s) => s.replace(/[-]/g, "\\-")).join("|");
  const compares = new RegExp(`\\bstep\\s*[!=]==\\s*"(${names})"|"(${names})"\\s*[!=]==\\s*[\\w.]*step\\b`);
  const setOfNames = new RegExp(`new Set\\(\\[\\s*"(${names})"`);

  test("no file under land-branch/ compares a step with a workflow step's name (AC-1)", () => {
    const found = read("src/serve/land-branch/**/*.ts").flatMap(({ file, text }) =>
      text.split("\n").filter((line) => compares.test(line) || setOfNames.test(line)).map((line) => `${file}: ${line.trim()}`),
    );
    expect(found).toEqual([]);
  });
});
