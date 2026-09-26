// The file contract between a scheduled job's prompt and the board: reading
// the list, judging one proposal against the specs and Create jobs that exist,
// the source block a description ends with, and the record of what happened.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkProposal,
  descriptionRoom,
  parseProposalsFile,
  proposalsFileText,
  readProposalsRecord,
  sourceBlock,
  titleKey,
  writeProposalsRecord,
  type KnownSpec,
  type PendingCreate,
} from "../../src/queue/spec-proposals.ts";
import { scheduleRunOutputDir } from "../../src/queue/schedule.ts";
import { DESCRIPTION_MAX, TITLE_MAX } from "../../src/queue/parse-request.ts";

const KNOWN: KnownSpec[] = [
  { folder: "01-alpha", title: "Alpha", kind: "active" },
  { folder: "02-beta", title: "Beta thing", kind: "archived" },
  { folder: "03-gamma", title: "Gamma", kind: "closed" },
  { folder: "04-untitled", title: null, kind: "active" },
];

const check = (entry: unknown, jobs: PendingCreate[] = [], known = KNOWN) =>
  checkProposal(entry, 4000, known, jobs);

describe("parseProposalsFile", () => {
  test("a list of two entries comes back whole and in file order (AC-1)", () => {
    const text = JSON.stringify([
      { title: "One", description: "First" },
      { title: "Two", description: "Second" },
    ]);
    expect(parseProposalsFile(text)).toEqual({
      entries: [
        { title: "One", description: "First" },
        { title: "Two", description: "Second" },
      ],
    });
  });

  test("text that is not JSON answers with an error and no entries (AC-1)", () => {
    const got = parseProposalsFile("[{ nope");
    expect("error" in got && got.error.length > 0).toBe(true);
    expect("entries" in got).toBe(false);
  });

  test("JSON that is not a list answers with an error and no entries (AC-1)", () => {
    const got = parseProposalsFile('{"title":"x"}');
    expect("error" in got).toBe(true);
    expect("entries" in got).toBe(false);
  });
});

describe("titleKey", () => {
  test("trims, collapses whitespace and lowercases (AC-3)", () => {
    expect(titleKey("  Fix   the\tThing \n")).toBe("fix the thing");
  });
});

describe("checkProposal", () => {
  test("a fresh title passes, with title and description trimmed", () => {
    expect(check({ title: " New idea ", description: " Body\r\n" })).toEqual({
      ok: true,
      proposal: { title: "New idea", description: "Body" },
    });
  });

  test("a title equal to an active, archived or closed spec is skipped as existing, in any case and spacing (AC-3)", () => {
    expect(check({ title: "alpha", description: "d" })).toMatchObject({
      ok: false,
      why: { code: "exists", folder: "01-alpha", kind: "active" },
    });
    expect(check({ title: "  BETA   Thing", description: "d" })).toMatchObject({
      ok: false,
      why: { code: "exists", folder: "02-beta", kind: "archived" },
    });
    expect(check({ title: "gamma", description: "d" })).toMatchObject({
      ok: false,
      why: { code: "exists", folder: "03-gamma", kind: "closed" },
    });
  });

  test("a Create job that is queued, running or done blocks the same title, naming the job (AC-3)", () => {
    for (const state of ["queued", "running", "done"]) {
      const got = check({ title: "Wanted", description: "d" }, [{ id: "j1", state, createTitle: "wanted" }]);
      expect(got).toMatchObject({ ok: false, why: { code: "queued", jobId: "j1" } });
    }
  });

  test("a Create job that failed, was cancelled, stopped or was interrupted blocks nothing (AC-3)", () => {
    for (const state of ["failed", "cancelled", "stopped", "interrupted"]) {
      const got = check({ title: "Wanted", description: "d" }, [{ id: "j1", state, createTitle: "Wanted" }]);
      expect(got.ok).toBe(true);
    }
  });

  test("an entry that is not an object, or has no title or description, is invalid (AC-3)", () => {
    expect(check("nope")).toMatchObject({ ok: false, why: { code: "invalid", what: "not-an-object" } });
    expect(check(null)).toMatchObject({ ok: false, why: { code: "invalid", what: "not-an-object" } });
    expect(check({ description: "d" })).toMatchObject({ ok: false, why: { code: "invalid", what: "title-missing" } });
    expect(check({ title: "  ", description: "d" })).toMatchObject({
      ok: false,
      why: { code: "invalid", what: "title-missing" },
    });
    expect(check({ title: "T" })).toMatchObject({ ok: false, why: { code: "invalid", what: "description-missing" } });
  });

  test("a two-line title and a title over the limit are invalid, with the limit (AC-3)", () => {
    expect(check({ title: "a\nb", description: "d" })).toMatchObject({
      ok: false,
      why: { code: "invalid", what: "title-lines" },
    });
    expect(check({ title: "x".repeat(TITLE_MAX + 1), description: "d" })).toMatchObject({
      ok: false,
      why: { code: "invalid", what: "title-long", max: TITLE_MAX },
    });
    expect(check({ title: "x".repeat(TITLE_MAX), description: "d" }).ok).toBe(true);
  });

  test("a description over the room it is given is invalid, with that room (AC-3)", () => {
    expect(checkProposal({ title: "T", description: "y".repeat(101) }, 100, [], [])).toMatchObject({
      ok: false,
      why: { code: "invalid", what: "description-long", max: 100 },
    });
    expect(checkProposal({ title: "T", description: "y".repeat(100) }, 100, [], []).ok).toBe(true);
  });

  test("an invalid entry still reports its title for the record", () => {
    expect(check({ title: "Named", description: "" })).toMatchObject({ ok: false, title: "Named" });
    expect(check(42)).toMatchObject({ ok: false, title: "" });
  });
});

describe("sourceBlock and descriptionRoom", () => {
  const block = sourceBlock({
    name: "nyhetssjekk",
    project: "aide",
    runId: "run-1",
    startedAt: "2026-09-26T18:00:04Z",
    reportPath: "/schedule/aide/nyhetssjekk?run=run-1#report",
  });

  test("names the job, the project and the run and links to the report (AC-5)", () => {
    expect(block).toContain("### Source");
    expect(block).toContain("`nyhetssjekk`");
    expect(block).toContain("`aide`");
    expect(block).toContain("`run-1`");
    expect(block).toContain("2026-09-26T18:00:04Z");
    expect(block).toContain("[/schedule/aide/nyhetssjekk?run=run-1#report](/schedule/aide/nyhetssjekk?run=run-1#report)");
  });

  test("the room left for a description is what the block and its blank line do not take (AC-5)", () => {
    expect(descriptionRoom(block)).toBe(DESCRIPTION_MAX - block.length - 2);
  });
});

describe("the record", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  test("is read back as it was written, and is absent before it is written (AC-3)", () => {
    const root = mkdtempSync(join(tmpdir(), "aide-proposals-"));
    dirs.push(root);
    mkdirSync(scheduleRunOutputDir(root, "aide", "schedule-n", "j1"), { recursive: true });
    expect(readProposalsRecord(root, "aide", "schedule-n", "j1")).toBeNull();
    const record = {
      at: "2026-09-26T18:00:09Z",
      proposals: [
        { title: "A", result: "created" as const, jobId: "b1" },
        { title: "B", result: "skipped" as const, why: { code: "exists" as const, folder: "01-x", kind: "closed" as const } },
      ],
    };
    writeProposalsRecord(root, "aide", "schedule-n", "j1", record);
    expect(readProposalsRecord(root, "aide", "schedule-n", "j1")).toEqual(record);
    expect(readProposalsRecord(root, "aide", "schedule-n", "j2")).toBeNull();
  });

  test("a file that is not a record reads as absent", () => {
    const root = mkdtempSync(join(tmpdir(), "aide-proposals-"));
    dirs.push(root);
    const dir = scheduleRunOutputDir(root, "aide", "schedule-n", "j1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "proposed-specs-result.json"), "not json");
    expect(readProposalsRecord(root, "aide", "schedule-n", "j1")).toBeNull();
    expect(proposalsFileText(root, "aide", "schedule-n", "j1")).toBeNull();
  });
});
