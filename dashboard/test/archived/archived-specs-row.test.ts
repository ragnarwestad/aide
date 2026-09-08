// Split out of archived-specs.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import type { GitRunner } from "../../src/git/branch-status.ts";
import {
  ARCHIVED_VIEW, LONG_TAIL, SAME_DAY, STAMPED, STAMPED_COST_LABEL, STAMPED_TIME_SHOWN, STAMPED_TIME_SPENT, TWO_TOOLS, UNDATED,
  UNSTAMPED, blockFor, described, gitDated, harness, noStamp, opened, outcome, rowFor, specsList, stamp, start,
} from "./archived-specs-fixtures.ts";

afterEach(() => harness.cleanup());

// --- criterion 3: it is a READER row ---------------------------------------

describe("an archived spec's row", () => {
  test("links its spec page, dates it, and offers Reopen (criterion 3)", async () => {
    const html = await specsList(start().base, ARCHIVED_VIEW);
    const row = rowFor(html, STAMPED);
    expect(row).toContain(`href="/specs/aide/${STAMPED}"`);
    expect(row).toContain(STAMPED_TIME_SHOWN);
    // Reopen rides the caption line the fold opens, like every other
    // row's one action (2026-09-08) — the head line is information.
    const open = blockFor(await specsList(start().base, `${ARCHIVED_VIEW}${opened(STAMPED)}`), STAMPED);
    expect(open).toContain("Reopen");
    expect(open).toContain('name="steps" value="reopen"');
  });

  test("draws no model select, no tick box and no Run (criterion 3)", async () => {
    const html = await specsList(start({ queueDefaults: TWO_TOOLS }).base, ARCHIVED_VIEW);
    const row = rowFor(html, STAMPED);
    expect(row).not.toContain("<select");
    expect(row).not.toContain('type="checkbox"');
    // The Run form is a carrier with an id of its own; a reader row must
    // not carry one, nor the button that submits it.
    expect(row).not.toContain('class="rowrun"');
    expect(row).not.toContain("starting…");
  });

  // Spec 224 turned this line round. It read `not.toContain('class="fold')`
  // until then, on the grounds that a reader row had nothing under it to
  // open — and that was the whole of what made it a second kind of row.
  test("has the fold chevron every other row has (spec 224)", async () => {
    expect(rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED)).toContain('class="fold');
  });

  // The pips came off the list on 2026-09-07 and the action moved onto
  // the caption line on 2026-09-08; what a locked row carries there is
  // the slot every other row has, holding its one action.
  test("carries the same action slot as every other row", async () => {
    const open = blockFor(await specsList(start().base, `${ARCHIVED_VIEW}${opened(STAMPED)}`), STAMPED);
    expect(open).toContain('<span class="actionslot">');
    // And its head line carries no control at all, the same as every
    // other shut row.
    expect(rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED)).not.toContain("<button");
  });

  // Criterion 7. `stateAction`'s ordinary branches name the phase a
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

  test("says what it is, in the column that says what every row is", async () => {
    expect(rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED)).toContain(">archived<");
  });

  // Spec 224. `nextPhase` deletes `archive` from the done-set before it
  // looks for what is missing — deliberately, for a row that is still on
  // this list — so a FINISHED spec routed through it resolves to
  // "archive" and its badge would read "ready". Ready for the step it
  // has already had.
  test("its badge never says the spec is ready for anything", async () => {
    const row = rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED);
    expect(row).not.toContain(">ready<");
  });

  // `activeDurationCell` (the live row's own cell, spec 281) reads
  // `g.totalDurationMs`, not a date — an archived row draws through
  // `archiveDateCell` instead, which is what gives it the date fallback
  // this cell has none of.
  test("its duration is in the column every row's date is in, with no date beside it", async () => {
    const row = rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED);
    const cell = row.slice(row.indexOf('data-col="started"'));
    const body = cell.slice(0, cell.indexOf("</td>"));
    expect(body).toContain(STAMPED_TIME_SHOWN);
    // Once a duration exists, the archive date is dropped from this cell
    // entirely — it read as noise beside the figure that actually answers
    // "how long" (spec 257 made duration the lead figure; this drops the
    // date that used to trail it).
    expect(body).not.toContain("2026-08-13");
  });

  // The sort key used to fall through to `g.createdAt`, which an
  // archived row almost never has (it is no target) — every archived
  // row tied at 0 and the click did nothing. It now reads the same
  // summed duration the cell itself shows.
  test("clicking Time actually reorders the archived rows, by duration", async () => {
    const html = await specsList(start().base, `${ARCHIVED_VIEW}&sort=started`);
    // `data-folder` is written more than once per spec (the fold toggle
    // carries its own copy) — only the spechead row's own is one row.
    const folders = [...html.matchAll(/<tr class="[^"]*spechead[^"]*"[^>]*data-folder="([^"]+)"/g)].map(
      (m) => m[1],
    );
    const stampedAt = folders.indexOf(STAMPED);
    const unstampedAt = folders.indexOf(UNSTAMPED);
    expect(stampedAt).toBeGreaterThanOrEqual(0);
    expect(unstampedAt).toBeGreaterThanOrEqual(0);
    // "started"'s default direction is descending (SORT_DEFAULT_DIR):
    // the spec with a real recorded duration (STAMPED, > 0) sorts before
    // the one with none (UNSTAMPED, tied at 0).
    expect(stampedAt).toBeLessThan(unstampedAt);
  });

  test("the column header reads Time, not Started (spec 257)", async () => {
    const html = await specsList(start().base, ARCHIVED_VIEW);
    const start_ = html.indexOf('<th class="" data-col="started"');
    const th = html.slice(start_, html.indexOf("</th>", start_));
    expect(th).toContain(">Time<");
    expect(th).not.toContain("Started");
  });

  // The stamp only started being written at spec 147; the older half of
  // the archive has none, and git remembers the commit that moved the
  // folder.
  // The Time column answers "how long", and nothing else: a spec whose
  // phases recorded no time reads as a dash, the same "nothing to show"
  // `costCell()` gives an all-zero spend. It used to fall back to the
  // archive date, which put a date under a heading that asks for a
  // duration.
  test("a spec with no recorded time shows 0s, never a date", async () => {
    const row = rowFor(await specsList(start().base, ARCHIVED_VIEW), UNSTAMPED);
    const timeCell = row.slice(row.indexOf('data-col="started"'));
    const body = timeCell.slice(0, timeCell.indexOf("</td>"));
    expect(body).toContain("0s");
    expect(body).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  // A blank cell for half the archive is the one outcome
  // 1-description.md ruled out by name.
  // A dash, not the words "date unknown": the cache is cold for a moment
  // after every restart, and a row that announces a failure it is about
  // to recover from teaches the reader to distrust the column.
  test("a spec neither the stamp nor git can date reads as a dash", async () => {
    const row = rowFor(await specsList(start().base, ARCHIVED_VIEW), UNDATED);
    expect(row).not.toContain("date unknown");
    const cell = row.slice(row.indexOf('data-col="created"'));
    expect(cell.slice(0, cell.indexOf("</td>"))).toContain("–");
  });

  test("carries what the spec cost in time, when its archive recorded one", async () => {
    expect(rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED)).toContain(STAMPED_TIME_SHOWN);
  });

  // Spec 410, REQ-4 put a "part." mark on a duration read from the
  // phase file's own stamp rather than measured by the queue. It is gone
  // (2026-09-08): a reader has nothing to do with that distinction, and
  // the answer is to record the whole time rather than to footnote the
  // part that was recorded.
  test("marks nothing on a file-only duration — the figure stands alone", async () => {
    const row = rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED);
    const cell = row.slice(row.indexOf('data-col="started"'));
    const body = cell.slice(0, cell.indexOf("</td>"));
    expect(body).not.toContain("part.");
    expect(body).not.toContain("the AI session's own time only");
  });

  // Acceptance criterion 4: nothing recorded across every phase is the
  // same "nothing to show" `costCell()` already gives an all-zero
  // `spentUsd` — a bare date, no duration span.
  // The column answers "how long" for every row, and `0s` is that
  // answer when no phase recorded a time — an empty cell asks whether
  // anything ran at all, which the row's own state already says.
  test("shows 0s when no phase recorded a time", async () => {
    const folder = "271-no-phase-recorded-a-time";
    const { base } = start({}, {
      [folder]: {
        description: described("No phase recorded a time", "Nothing to sum here."),
        status: noStamp,
      },
    });
    const row = rowFor(await specsList(base, ARCHIVED_VIEW), folder);
    const cell = row.slice(row.indexOf('data-col="started"'));
    const body = cell.slice(0, cell.indexOf("</td>"));
    expect(body).toContain("0s");
    expect(body).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  // Acceptance criterion 2: the exact bug 1-description.md names — the
  // one-shot `4-status.md` stamp never got written (the queue's LRU cap
  // evicted the job before archive landed) — but the phase's own file
  // still carries its `Time spent:` line, and the sum reads off that.
  test("carries the summed duration even with no 4-status.md stamp at all", async () => {
    const folder = "272-no-stamp-but-phase-outcomes";
    const { base } = start({}, {
      [folder]: {
        description: described("No stamp but phase outcomes", "The stamp never got written."),
        status: noStamp,
        analysis: outcome({ timeSpent: STAMPED_TIME_SPENT }),
      },
    });
    const row = rowFor(await specsList(base, ARCHIVED_VIEW), folder);
    const cell = row.slice(row.indexOf('data-col="started"'));
    const body = cell.slice(0, cell.indexOf("</td>"));
    expect(body).toContain(STAMPED_TIME_SHOWN);
  });

  // Spec 257: the head row's own Cost cell hardcoded `spentUsd: 0` even
  // though each phase's own real cost was already available — summed
  // here off the same phases that already carry it (the analyze phase
  // is STAMPED's only one with a recorded cost).
  test("carries the sum of its phases' recorded costs in the head row's Cost cell", async () => {
    const row = rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED);
    const cell = row.slice(row.indexOf('data-col="cost"'));
    expect(cell.slice(0, cell.indexOf("</td>"))).toContain(STAMPED_COST_LABEL);
  });

  // Spec 260: an archived spec whose only recorded figure is tokens (a
  // Codex-only run — no `Cost:` line anywhere) must still show something
  // in the head row's Cost cell, not the blank dash a `spentUsd` of `0`
  // used to leave behind.
  test("carries the sum of its phases' recorded tokens when no phase recorded a cost (spec 260, AC7)", async () => {
    const folder = "260-a-codex-only-archive";
    const { base } = start({}, {
      [folder]: {
        description: described("A Codex-only archive", "One archived spec, no dollar figure at all."),
        status: stamp("2026-08-26", ["create", "analyze"]),
        analysis: outcome({ tokens: "9562" }),
      },
    });
    const row = rowFor(await specsList(base, ARCHIVED_VIEW), folder);
    const cell = row.slice(row.indexOf('data-col="cost"'));
    const body = cell.slice(0, cell.indexOf("</td>"));
    expect(body).toContain('<span class="u-tok">9.6k</span>');
    expect(body).not.toContain("$0.00");
  });

  // Spec 257: the description no longer shows under the title at all —
  // recorded or not, long or short. It stays SEARCHABLE (see the search
  // tests below), only the on-page display goes.
  test("shows no description text under the title, recorded or not", async () => {
    const withDescription = rowFor(await specsList(start().base, ARCHIVED_VIEW), UNSTAMPED);
    expect(withDescription).not.toContain("archive-desc");
    expect(withDescription).not.toContain(LONG_TAIL);
  });

  test("shows no dash placeholder either, for a spec with no description", async () => {
    const withoutDescription = rowFor(await specsList(start().base, ARCHIVED_VIEW), UNDATED);
    expect(withoutDescription).not.toContain("archive-desc");
    expect(withoutDescription).not.toContain("—");
  });

  // --- spec 317, REQ-6: an archived row's own Created date -------------------

  // SAME_DAY has no recorded phase duration, so its Time cell reads
  // `0s`. Created must show the spec's TRUE beginning — and no cell on
  // the row may carry the archive stamp ("2026-08-13") in its place.
  test("carries its own creation date, distinct from the archive date beside it (REQ-6)", async () => {
    const gitRun: GitRunner = async (dir, args) => {
      if (args.join(" ").startsWith("log --follow --format=%aI") && dir.includes(SAME_DAY)) {
        return { code: 0, stdout: "2026-07-01T09:00:00+02:00\n" };
      }
      return gitDated({ [UNSTAMPED]: "2026-07-30T11:02:00+02:00" })(dir, args);
    };
    const { base } = start({ gitRun });
    const row = rowFor(await specsList(base, ARCHIVED_VIEW), SAME_DAY);
    const timeCell = row.slice(row.indexOf('data-col="started"'));
    const time = timeCell.slice(0, timeCell.indexOf("</td>"));
    expect(time).toContain("0s");
    expect(time).not.toContain("2026-08-13");
    const createdCell = row.slice(row.indexOf('data-col="created"'));
    const body = createdCell.slice(0, createdCell.indexOf("</td>"));
    expect(body).toContain("2026-07-01");
    expect(body).not.toContain("2026-08-13");
  });

  // A spec with nothing for the rename-aware lookup to find (no
  // 1-description.md history) is a real, honest "cannot date" — the
  // same dash convention every other undatable spec on this page shows.
  test("shows the dash convention when the rename-aware lookup cannot date it (REQ-5)", async () => {
    const row = rowFor(await specsList(start().base, ARCHIVED_VIEW), UNDATED);
    const createdCell = row.slice(row.indexOf('data-col="created"'));
    expect(createdCell.slice(0, createdCell.indexOf("</td>"))).toContain("–");
  });
});
