// Which schedule entries the /schedule list shows for a search, and the
// order it puts them in.
import { describe, expect, test } from "bun:test";
import { matchesSearch, sortRows, type SchedulePageRow } from "../../../../src/render/pages/schedule-page/list.ts";

const NOW = new Date("2026-08-30T00:00:00Z");

const entry = (project: string, name: string, over: Partial<SchedulePageRow["entry"]> = {}, lastRunAt?: string): SchedulePageRow => ({
  project,
  entry: { name, cron: "0 3 * * *", prompt: `docs/${name}.md`, enabled: true, ...over },
  lastRunAt,
  projectScheduleHref: `/projects/${project}?tab=schedule`,
});

const names = (rows: SchedulePageRow[]): string[] => rows.map((r) => `${r.project}:${r.entry.name}`);

describe("matchesSearch", () => {
  const row = entry("aide", "Nightly-Report", { prompt: "docs/nightly.md" });

  test("matches the project:name, whatever the case", () => {
    expect(matchesSearch(row, { q: "AIDE:nightly" })).toBe(true);
  });

  test("matches the prompt path", () => {
    expect(matchesSearch(row, { q: "docs/nightly" })).toBe(true);
  });

  test("a term found nowhere does not match", () => {
    expect(matchesSearch(row, { q: "weekly" })).toBe(false);
  });

  test("no term, or one of nothing but spaces, matches every row", () => {
    expect(matchesSearch(row, {})).toBe(true);
    expect(matchesSearch(row, { q: "   " })).toBe(true);
  });
});

describe("sortRows", () => {
  test("with no sort asked for, orders by project:name ascending", () => {
    const rows = [entry("atlasaurus", "weekly-check"), entry("aide", "zed"), entry("aide", "nightly-report")];
    expect(names(sortRows(rows, {}, NOW))).toEqual(["aide:nightly-report", "aide:zed", "atlasaurus:weekly-check"]);
    expect(names(sortRows(rows, { dir: "desc" }, NOW))).toEqual(["atlasaurus:weekly-check", "aide:zed", "aide:nightly-report"]);
  });

  test("enabled puts the enabled entries first, and asc the disabled ones, ties by name either way", () => {
    const rows = [entry("aide", "b-off", { enabled: false }), entry("aide", "c-on"), entry("aide", "a-on")];
    expect(names(sortRows(rows, { sort: "enabled" }, NOW))).toEqual(["aide:a-on", "aide:c-on", "aide:b-off"]);
    expect(names(sortRows(rows, { sort: "enabled", dir: "asc" }, NOW))).toEqual(["aide:b-off", "aide:a-on", "aide:c-on"]);
  });

  test("next puts the soonest next run first", () => {
    const rows = [entry("aide", "a-late", { cron: "0 5 * * *" }), entry("aide", "b-soon", { cron: "0 1 * * *" })];
    expect(names(sortRows(rows, { sort: "next" }, NOW))).toEqual(["aide:b-soon", "aide:a-late"]);
  });

  test("last puts the most recent run first, and a never-run entry last", () => {
    const rows = [
      entry("aide", "a-never"),
      entry("aide", "b-old", {}, "2026-08-01T00:00:00Z"),
      entry("aide", "c-new", {}, "2026-08-29T00:00:00Z"),
    ];
    expect(names(sortRows(rows, { sort: "last" }, NOW))).toEqual(["aide:c-new", "aide:b-old", "aide:a-never"]);
  });
});
