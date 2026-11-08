// Split out of archived-specs.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import type { GitRunner } from "../../src/git/branch-status.ts";
import {
  ARCHIVED_VIEW, SAME_DAY, STAMPED, TWO_TOOLS, UNSTAMPED, blockFor, harness, opened, order, rowFor,
  specsList, start,
} from "./archived-specs-fixtures.ts";

afterEach(() => harness.cleanup());

// --- It is a READER row ---------------------------------------

describe("an archived spec's row", () => {
  test("draws no model select, no tick box and no Run", async () => {
    const html = await specsList(start({ queueDefaults: TWO_TOOLS }).base, ARCHIVED_VIEW);
    const row = rowFor(html, STAMPED);
    expect(row).not.toContain("<select");
    expect(row).not.toContain('type="checkbox"');
    // The Run form is a carrier with an id of its own; a reader row must
    // not carry one, nor the button that submits it.
    expect(row).not.toContain('class="rowrun"');
    expect(row).not.toContain("Starting…");
  });

  // `stateAction`'s ordinary branches name the phase a
  // press would run; a locked row's one action is Reopen, open or shut.
  test("offers no Analyze, Implement or Archive button — Reopen and nothing else", async () => {
    const shut = blockFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED);
    expect(shut).not.toContain("<button");
    const open = blockFor(await specsList(start().base, `${ARCHIVED_VIEW}${opened(STAMPED)}`), STAMPED);
    for (const label of ["Analyze", "Implement", "Archive"]) {
      expect(open).not.toContain(`>${label}</button>`);
    }
    expect(open).toContain(">Reopen</button>");
  });

  // `nextPhase` deletes `archive` from the done-set before it
  // looks for what is missing — deliberately, for a row that is still on
  // this list — so a FINISHED spec routed through it resolves to
  // "archive" and its badge would read "ready". Ready for the step it
  // has already had.
  test("its badge never says the spec is ready for anything", async () => {
    const row = rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED);
    expect(row).not.toContain(">ready<");
  });

  // --- the archive sorts by its own creation date ---------------------------

  // The dates run opposite to the folder numbers (150 oldest, 92 newest,
  // 60 between), so a sort that fell back to folder order, or to the
  // archive stamp, would come out differently.
  test("archived rows sort by the date git gives their spec, both ways", async () => {
    const dates: Record<string, string> = {
      [STAMPED]: "2026-06-01T09:00:00+02:00",
      [SAME_DAY]: "2026-07-01T09:00:00+02:00",
      [UNSTAMPED]: "2026-07-30T11:02:00+02:00",
    };
    const gitRun: GitRunner = async (dir, args) => {
      if (args.join(" ").startsWith("log --follow --format=%aI")) {
        const folder = Object.keys(dates).find((f) => dir.includes(f));
        if (folder) return { code: 0, stdout: `${dates[folder]}\n` };
      }
      return { code: 1, stdout: "" };
    };
    const { base } = start({ gitRun });
    const dated = [STAMPED, SAME_DAY, UNSTAMPED];
    const listed = async (dir: string) =>
      order(await specsList(base, `${ARCHIVED_VIEW}&sort=created&dir=${dir}`)).filter((f) => dated.includes(f));
    expect(await listed("desc")).toEqual([UNSTAMPED, SAME_DAY, STAMPED]);
    expect(await listed("asc")).toEqual([STAMPED, SAME_DAY, UNSTAMPED]);
  });
});
