import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type ArchivedSpecView, type SpecsFilter } from "../../../../../src/render";

// --- spec 510: an archived row unfolds the criteria that wait for a check ------

const FOLDER = "500-archived-spec";
const KEY = `aide/${FOLDER}`;
const NV = "| AC-4: works after the deploy | Not verified | Not tested: needs production |";
const DONE = "| AC-1: it folds | ✅ | |";
const FAILED = "| AC-6: failed earlier | ❌ Failed | Failed: it did not hold |";
const rowOf = (line: string) => {
  const cells = line.split("|").map((c) => c.trim());
  const mark = cells[2]!;
  return {
    phase: "Acceptance criteria",
    line,
    task: cells[1]!,
    done: mark === "✅" || /not verified/i.test(mark),
    ...(/not verified/i.test(mark) ? { notVerified: true } : {}),
    ...(/failed/i.test(mark) ? { failed: true } : {}),
    note: cells[3]!,
  };
};

const archived = (over: Partial<ArchivedSpecView> = {}): ArchivedSpecView => ({
  project: "aide",
  folder: FOLDER,
  archivedAt: "2026-09-15",
  done: ["create", "analyze", "implement", "archive"],
  models: {},
  phaseOutcomes: {},
  notVerified: 1,
  failed: 1,
  acceptance: [DONE, NV, FAILED].map(rowOf),
  ...over,
});
const draw = (a: ArchivedSpecView, filter: SpecsFilter = {}): string =>
  renderSpecsRows([], { runnerAvailable: true, targets: [], archivedSpecs: [a], filter });
const notice = (html: string): string => html.match(/<tr class="specnotice"[^>]*>[\s\S]*?<\/tr>/)?.[0] ?? "";

describe("an archived row with criteria waiting for a check has a › of its own (AC-1, AC-4)", () => {
  test("folded: a › that adds the spec's key, and no criteria drawn", () => {
    const html = notice(draw(archived()));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(`checks=${encodeURIComponent(KEY)}`);
    expect(html).not.toContain("AC-4: works after the deploy");
  });

  test("an archived row with nothing waiting has no such line", () => {
    const html = draw(archived({ notVerified: undefined, failed: undefined, acceptance: undefined }));
    expect(html).not.toContain("rowchecks");
    expect(notice(html)).toBe("");
  });

  test("a closed spec has none either", () => {
    expect(draw(archived({ closed: true }), { checks: KEY })).not.toContain("rowchecks");
  });

  const open = notice(draw(archived(), { checks: KEY }));

  test("unfolded: a Not verified row has tick, Failed and a note field; posted as a list press (AC-4)", () => {
    expect(open).toContain(`action="/api/queue/specs/aide/${FOLDER}/tick?fromList=1"`);
    expect(open).toContain('name="checksPhase" value="Acceptance criteria"');
    expect(open).toContain(`<input type="checkbox" name="tick" value="${NV}"`);
    expect(open).toContain(`<input type="checkbox" name="failed" value="${NV}"`);
    expect(open).toContain('name="failnote-0"');
    expect(open).not.toContain('name="unverified"');
  });

  test("every other row is read-only: no box, and a Failed row shows its note and a Reopen link (AC-4, AC-8)", () => {
    expect(open).not.toContain(`value="${DONE}"`);
    expect(open).not.toContain(`value="${FAILED}"`);
    expect(open).toContain("Failed: it did not hold");
    expect(open).toContain(`href="/specs/aide/${FOLDER}/reopen"`);
  });

  test("a row with only Failed rows draws no Save and no form, only the Reopen link (AC-8)", () => {
    const only = notice(draw(archived({ notVerified: undefined, acceptance: [DONE, FAILED].map(rowOf) }), { checks: KEY }));
    expect(only).not.toContain("<form");
    expect(only).toContain(`href="/specs/aide/${FOLDER}/reopen"`);
  });
});
