import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type ArchivedSpecView, type SpecsFilter, type SpecTarget } from "../../../../../src/render";

// --- spec 509: the Not verified entry of the State dropdown -------------------

const archived = (folder: string, over: Partial<ArchivedSpecView> = {}): ArchivedSpecView => ({
  project: "aide",
  folder,
  archivedAt: "2026-09-15",
  done: ["create", "analyze", "implement", "archive"],
  models: {},
  phaseOutcomes: {},
  ...over,
});
const live = (specFolder: string, over: Partial<SpecTarget> = {}): SpecTarget => ({ project: "aide", specFolder, ...over });

const draw = (opts: {
  targets?: SpecTarget[];
  archivedSpecs?: ArchivedSpecView[];
  archivedKeys?: string[];
  notVerified?: string[];
  filter?: SpecsFilter;
}): string =>
  renderSpecsRows([], {
    runnerAvailable: true,
    targets: opts.targets ?? [],
    archivedSpecs: opts.archivedSpecs,
    archived: opts.archivedKeys,
    notVerified: opts.notVerified,
    filter: opts.filter,
  });

const folders = (html: string): string[] =>
  [...html.matchAll(/<tr class="[^"]*spechead[^"]*"[^>]*data-folder="([^"]+)"/g)].map((m) => m[1]!).sort();
const entryCount = (html: string): number | null => {
  const m = html.match(/href="[^"]*state=not-verified[^"]*" role="radio"[^>]*>[\s\S]*?Not verified \((\d+)\)<\/a>/);
  return m ? Number(m[1]) : null;
};

describe("the Not verified entry lists rows with a count, live and archived alike", () => {
  test("only the live and the archived spec with a count are listed (AC-4)", () => {
    const html = draw({
      targets: [live("10-live-with", { notVerified: 1 }), live("11-live-none")],
      archivedSpecs: [archived("20-arch-with", { notVerified: 2 }), archived("21-arch-none")],
      archivedKeys: ["aide/20-arch-with", "aide/21-arch-none"],
      filter: { state: "not-verified" },
    });
    expect(folders(html)).toEqual(["10-live-with", "20-arch-with"]);
  });

  test("a closed spec is never listed by it (AC-4)", () => {
    const html = draw({
      archivedSpecs: [archived("30-closed", { closed: true, notVerified: 2 })],
      filter: { state: "not-verified" },
    });
    expect(folders(html)).toEqual([]);
  });

  test("its count on the Active view includes the archived spec with a count and not every unbuilt archived key (AC-4)", () => {
    const html = draw({
      targets: [live("10-live-with", { notVerified: 1 }), live("11-live-none")],
      archivedKeys: ["aide/20-arch-with", "aide/21-arch-none", "aide/22-arch-none"],
      notVerified: ["aide/20-arch-with"],
      filter: { state: "not-archived" },
    });
    expect(entryCount(html)).toBe(2);
  });

  test("its count is dropped while a search term is set (AC-4)", () => {
    const html = draw({
      targets: [live("10-live-with", { notVerified: 1, title: "findme" })],
      archivedKeys: ["aide/20-arch-with"],
      notVerified: ["aide/20-arch-with"],
      filter: { state: "not-archived", q: "findme" },
    });
    // The live row still matches the term; only the unbuilt archived key is left out.
    expect(entryCount(html)).toBe(1);
  });

  test("a spec whose only Not verified row was ticked has no count, so it is not in the entry (AC-6)", () => {
    const html = draw({
      targets: [live("10-was-marked", { notVerified: undefined })],
      archivedSpecs: [archived("20-was-marked", { notVerified: undefined })],
      archivedKeys: ["aide/20-was-marked"],
      filter: { state: "not-verified" },
    });
    expect(folders(html)).toEqual([]);
    expect(entryCount(html)).toBe(0);
  });
});
