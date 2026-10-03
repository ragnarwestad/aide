// The warning a row carries while a ticked spec's analysis waits for the
// person to choose between its real alternatives: when it stands, that it
// is said once, and what each radio button names and links to.

import { describe, expect, test } from "bun:test";
import type { QueueRowView, SpecTarget } from "../../../../../src/render";
import { groupBySpec } from "../../../../../src/render/pages/specs-list/data-model";
import { errorMarkNotices } from "../../../../../src/render/pages/specs-list/row-marks.ts";
import { approachHref, approachItems } from "../../../../../src/render/pages/specs-list/approach-choice/index.ts";
import { specTabPath } from "../../../../../src/render/pages/spec-page/tabs.ts";
import { specNotice } from "../../../../../src/render/ui/job-state";
import { row } from "../../fixtures.ts";

const FOLDER = "590-choose-the-approach";
const PENDING = [
  { letter: "A", title: "Hold the chained implement", mark: "recommended" as const },
  { letter: "B", title: "End the job after analyze", mark: "real alternative" as const },
];

const target = (extra: Partial<SpecTarget> = {}): SpecTarget => ({
  project: "aide",
  specFolder: FOLDER,
  done: ["create", "analyze"],
  historyDone: ["create", "analyze"],
  approachChoice: PENDING,
  ...extra,
});

/** The chained job, held queued for the choice. */
const held = (): QueueRowView =>
  row({
    specFolder: FOLDER,
    steps: ["analyze", "implement"],
    stepIndex: 1,
    state: "queued",
    error: { key: "runner.approachChoice" },
    errorReason: "held-back",
  });

const groupOf = (rows: QueueRowView[], t: SpecTarget = target()) => groupBySpec(rows, [t])[0]!;
const approachMarks = (rows: QueueRowView[], t?: SpecTarget) =>
  errorMarkNotices(groupOf(rows, t), "en", () => false).filter((m) => m.kind === "approach-choice");

describe("the approach warning on a row", () => {
  test("stands on its own line while the chained job is held for the choice (AC-3)", () => {
    const marks = approachMarks([held()]);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.own).toBe(true);
    expect(marks[0]!.variant).toBe("waiting");
  });

  test("the held job's own sentence is not said a second time (AC-3)", () => {
    const g = groupOf([held()]);
    const notice = specNotice(g.lead, undefined, undefined, errorMarkNotices(g, "en", () => false), "en");
    const texts = (notice?.parts ?? [{ text: notice?.text ?? "" }]).map((p) => p.text);
    expect(texts.filter((text) => text.includes("choose the approach"))).toHaveLength(1);
  });

  test("stands with no job at all, since Implement does not start on its own (AC-3)", () => {
    expect(approachMarks([])).toHaveLength(1);
  });

  test("is quiet while the analyze runs (AC-3)", () => {
    const running = row({ specFolder: FOLDER, steps: ["analyze", "implement"], stepIndex: 0, state: "running" });
    expect(approachMarks([running])).toHaveLength(0);
  });

  test("is gone with no pending choice: fewer than two real alternatives, or one chosen (AC-4, AC-7)", () => {
    expect(approachMarks([held()], target({ approachChoice: undefined }))).toHaveLength(0);
  });

  test("is gone once an Implement has completed since the analysis (AC-8)", () => {
    const t = target({ done: ["create", "analyze", "implement"], historyDone: ["create", "analyze", "implement"] });
    expect(approachMarks([], t)).toHaveLength(0);
  });
});

describe("the approaches the warning offers", () => {
  test("names each real alternative by letter and title, links it to its lead, and checks the recommended one (AC-3)", () => {
    const solution = specTabPath("aide", FOLDER, "solution");
    expect(approachItems(groupOf([held()]))).toEqual([
      { letter: "A", title: "Hold the chained implement", href: `${solution}#approach-a`, checked: true, recommended: true },
      { letter: "B", title: "End the job after analyze", href: `${solution}#approach-b`, checked: false, recommended: false },
    ]);
  });

  test("the link is the Solution tab's address with the letter in lower case (AC-3)", () => {
    expect(approachHref("aide", FOLDER, "C")).toBe(`${specTabPath("aide", FOLDER, "solution")}#approach-c`);
  });
});
