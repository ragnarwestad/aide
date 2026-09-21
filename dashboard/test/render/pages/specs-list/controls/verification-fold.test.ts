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

  test("the Failed box and its note are one block, the note a five-line text area bounded at 500 (AC-2, AC-3, AC-4)", () => {
    const block = /<div class="failcontrol">(.*?)<\/div>/s.exec(open)?.[1] ?? "";
    expect(block).toMatch(/^<label class="unverified"><input type="checkbox" name="failed"/);
    expect(block).toMatch(/<\/label><textarea class="failnote" name="failnote-0"[^>]* rows="5" maxlength="500"/);
    expect(open).not.toContain('<input type="text" class="failnote"');
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

// --- spec 520: the count is said once, and an open row reads phase lines first --

describe("an archived row says its count once, on the info line (AC-1, AC-2, AC-3)", () => {
  const count = (html: string, text: string) => html.split(text).length - 1;
  const head = (html: string) => html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
  const twoNv = archived({ notVerified: 2, failed: undefined, acceptance: [DONE, NV, NV].map(rowOf) });

  test("2 not verified: once in the info line, no line under the title (AC-1)", () => {
    const html = draw(twoNv);
    expect(count(html, "2 not verified")).toBe(1);
    expect(notice(html)).toContain("2 not verified");
    expect(head(html)).not.toContain("spec-notverified");
  });

  test("one not verified and one failed: once, in the info line (AC-1)", () => {
    const html = draw(archived());
    expect(count(html, "1 not verified · 1 failed")).toBe(1);
    expect(notice(html)).toContain("1 not verified · 1 failed");
    expect(html).not.toContain("spec-notverified");
  });

  test("only Failed rows: 3 failed once, in the info line (AC-1)", () => {
    const html = draw(archived({ notVerified: undefined, failed: 3, acceptance: [DONE, FAILED, FAILED, FAILED].map(rowOf) }));
    expect(count(html, "3 failed")).toBe(1);
    expect(notice(html)).toContain("3 failed");
    expect(html).not.toContain("spec-notverified");
  });

  test("a count with no readable acceptance rows keeps the line under the title (AC-3)", () => {
    const html = draw(archived({ acceptance: undefined }));
    expect(head(html)).toContain("spec-notverified");
    expect(notice(html)).toBe("");
  });

  test("a closed spec draws neither (AC-3)", () => {
    const html = draw(archived({ closed: true }));
    expect(html).not.toContain("spec-notverified");
    expect(notice(html)).toBe("");
  });

  test("open: the first phase line follows the head row, the info line follows the last (AC-2)", () => {
    const html = draw(archived(), { open: KEY });
    const at = (s: string) => html.indexOf(s);
    const subrows = [...html.matchAll(/<tr class="subrow/g)].map((m) => m.index!);
    expect(subrows.length).toBeGreaterThan(0);
    const headEnd = html.indexOf("</tr>", at("spechead")) + "</tr>".length;
    expect(html.slice(headEnd, subrows[0]!).trim()).toBe("");
    expect(at('<tr class="specnotice"')).toBeGreaterThan(subrows[subrows.length - 1]!);
  });

  test("collapsed: the head row, then the info line, as before (AC-2, AC-4)", () => {
    const html = draw(archived());
    expect(html).not.toContain("subrow");
    expect(html.indexOf('<tr class="specnotice"')).toBeGreaterThan(html.indexOf("spechead"));
  });

  test("open with checks: the list sits in the info line, after the last phase line (AC-3)", () => {
    const html = draw(archived(), { open: KEY, checks: KEY });
    const list = html.indexOf('class="checklist"');
    const subrows = [...html.matchAll(/<tr class="subrow/g)].map((m) => m.index!);
    expect(list).toBeGreaterThan(subrows[subrows.length - 1]!);
    expect(list).toBeGreaterThan(html.indexOf('<tr class="specnotice"'));
  });
});
