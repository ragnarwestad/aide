// Split out of archived-specs.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import type { GitRunner } from "../../src/git/branch-status.ts";
import {
  ARCHIVED_VIEW, OTHER, SAME_DAY, STAMPED, UNDATED, UNSTAMPED, auth, blockFor, gitDated, harness,
  listUntil, opened, phaseLines, rowFor, specsList, start,
} from "./archived-specs-fixtures.ts";

// The reason a not-landed row carries moved from the badge itself
// (spec 275's "archived, not landed") to the notice line beneath it
// (spec 339) — the sentence to poll and assert on is that sentence now,
// not the old badge word, which no row renders any more.
const STILL_ON_ORIGIN = "its branch is still on origin — re-run archive";

afterEach(() => harness.cleanup());

// --- spec 224: a Reopen the server turns down --------------------------------

describe("a failed Reopen", () => {
  // The old flat row bypassed `specNoticeRow` altogether, so a refusal
  // had nowhere on the list to be read. Routed through the shared row
  // body, an archived row gets the panel every other row has.
  test("says why, on the row it was pressed on", async () => {
    const key = `aide/${STAMPED}`;
    const html = await specsList(
      start().base,
      `${ARCHIVED_VIEW}&error=${encodeURIComponent("already reopened")}&errorSpec=${encodeURIComponent(key)}`,
    );
    expect(blockFor(html, STAMPED)).toContain("already reopened");
  });
});

// --- criterion 4: spec 193's mark carries over ------------------------------
//
// Three specs reached the archive with their code still on a branch,
// and every row said done. This is the half that reaches a spec whose
// job the queue's LRU cap has long since evicted — 146's case — so the
// mark is derived from origin, not from the job.

describe("an archived spec whose branch is still on origin", () => {
  /** The dating runner every test here needs, plus origin's answer for
   *  "which spec branches are still open". `open` names the folders. */
  const gitWithBranches = (open: string[]): GitRunner =>
    async (dir, args) => {
      const a = args.join(" ");
      if (a.startsWith("ls-remote")) {
        return {
          code: 0,
          stdout: open.map((f) => `a3f9c21deadbeef\trefs/heads/aide/${f}\n`).join(""),
        };
      }
      return gitDated({ [UNSTAMPED]: "2026-07-30T11:02:00+02:00" })(dir, args);
    };

  test("carries the not-landed mark (criterion 4)", async () => {
    const { base } = start({ gitRun: gitWithBranches([STAMPED]) });
    const html = await listUntil(base, STILL_ON_ORIGIN, ARCHIVED_VIEW);
    expect(blockFor(html, STAMPED).toLowerCase()).toContain(STILL_ON_ORIGIN);
  });

  test("and one whose branch is gone carries none", async () => {
    const { base } = start({ gitRun: gitWithBranches([STAMPED]) });
    const html = await listUntil(base, STILL_ON_ORIGIN, ARCHIVED_VIEW);
    expect(blockFor(html, SAME_DAY).toLowerCase()).not.toContain(STILL_ON_ORIGIN);
  });

  test("a repo origin cannot be asked about marks nothing", async () => {
    // An unanswerable question is not evidence: a network blip must not
    // stamp the whole archive as unlanded.
    const unreachable: GitRunner = async (dir, args) =>
      args.join(" ").startsWith("ls-remote")
        ? { code: 128, stdout: "" }
        : gitDated({ [UNSTAMPED]: "2026-07-30T11:02:00+02:00" })(dir, args);
    const { base } = start({ gitRun: unreachable });
    // Wait for a tick to have happened at all, then ask: a page checked
    // before the schedule ran would pass for the wrong reason.
    await listUntil(base, "never appears", ARCHIVED_VIEW, 200);
    expect((await specsList(base, ARCHIVED_VIEW)).toLowerCase()).not.toContain(STILL_ON_ORIGIN);
  });

  // Spec 208, criterion 14. The set is whatever a schedule last found,
  // so how OLD it is decides how much of it to believe.
  test("the mark says how old its answer is", async () => {
    const { base } = start({ gitRun: gitWithBranches([STAMPED]) });
    const html = await listUntil(base, STILL_ON_ORIGIN, ARCHIVED_VIEW);
    expect(blockFor(html, STAMPED)).toContain("checked just now");
  });

  // The one row shape, not two (1-description.md). Before this spec an
  // unlanded archived spec came through `jobGroup` and read as an
  // ordinary, fully-interactive job row — with a Run the server would
  // have refused.
  test("is the same reader row as every other archived spec", async () => {
    const { base } = start({ gitRun: gitWithBranches([STAMPED]) });
    const html = await listUntil(base, STILL_ON_ORIGIN, ARCHIVED_VIEW);
    const row = rowFor(html, STAMPED);
    expect(row).not.toContain('class="rowrun"');
    expect(row).toContain("Reopen");
    // Spec 224: the same row means the same row OPEN too — the fold and
    // the phase lines under it, not a second shape wearing the mark.
    expect(row).toContain('class="fold');
    // Spec 339: the State cell says the bare word — the fact that
    // STAMPED's branch is still on origin is the notice line's to say.
    expect(row).toContain('<span class="badge b-done">archived</span>');
    expect(row).not.toContain(">archived, not landed<");
    expect(blockFor(html, STAMPED)).toContain(STILL_ON_ORIGIN);
    const open = await listUntil(base, STILL_ON_ORIGIN, `${ARCHIVED_VIEW}${opened(STAMPED)}`);
    expect(Object.keys(phaseLines(open, STAMPED))).toEqual([
      "create",
      "analyze",
      "implement",
      "archive",
    ]);
    expect(blockFor(open, STAMPED)).not.toContain('class="rowrun"');
  });

  // The exception the DEFAULT view keeps. "Active" is today's
  // reading view unchanged in content (1-description.md), and today it
  // shows this row: a spec archived with its work still on a branch has
  // not finished, and a reading view that dropped it would hide the
  // exact failure spec 193 exists to surface. Its landed siblings are
  // not there, so the archive itself is still not being paid for.
  // Every archived spec has a row on the default view now that All is
  // the default chip; what still sets this one apart is the MARK it
  // wears — its own branch is still on origin, so its work never landed.
  test("wears the not-landed mark its landed siblings do not", async () => {
    const { base } = start({ gitRun: gitWithBranches([STAMPED]) });
    const html = await listUntil(base, STILL_ON_ORIGIN);
    expect(blockFor(html, STAMPED).toLowerCase()).toContain(STILL_ON_ORIGIN);
    for (const folder of [UNSTAMPED, SAME_DAY, UNDATED, OTHER]) {
      expect(blockFor(html, folder).toLowerCase()).not.toContain(STILL_ON_ORIGIN);
    }
  });

  test("and the chips still count the whole archive behind it", async () => {
    const { base } = start({ gitRun: gitWithBranches([STAMPED]) });
    const html = await listUntil(base, STILL_ON_ORIGIN);
    // One row built, four keys with no row: the count is still five.
    expect(html).toMatch(/>Archived \(5\)</);
  });
});

// --- criterion 9: where Reopen lands the reader ----------------------------

describe("pressing Reopen", () => {
  /** The row's own form, submitted the way a browser with no script
   *  would submit it: url-encoded, and no redirect followed. */
  const press = (base: string, fields: Record<string, string>) =>
    fetch(`${base}/api/queue`, {
      method: "POST",
      redirect: "manual",
      headers: { ...auth.headers, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ project: "aide", specFolder: STAMPED, steps: "reopen", ...fields }),
    });

  test("from the list lands back on the list, filter kept (criterion 9)", async () => {
    const { base } = start();
    const res = await press(base, { fromList: "1", "view.state": "archived" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?state=archived");
  });

  test("from the spec's own page still lands there", async () => {
    const { base } = start();
    const res = await press(base, {});
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/specs/aide/${STAMPED}`);
  });

  test("the row's form is the one that carries the mark", async () => {
    const row = rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED);
    expect(row).toContain('name="fromList" value="1"');
  });
});
