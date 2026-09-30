// Split out of archived-specs.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import type { GitRunner } from "../../src/git/branch-status.ts";
import { ARCHIVED_VIEW, SAME_DAY, STAMPED, UNSTAMPED, blockFor, gitDated, harness, listUntil, specsList, start } from "./archived-specs-fixtures.ts";

// The reason a not-landed row carries moved from the badge itself
// (spec 275's "archived, not landed") to the notice line beneath it
// (spec 339) — the sentence to poll and assert on is that sentence now,
// not the old badge word, which no row renders any more.
const STILL_ON_ORIGIN = "its branch is still on origin — re-run archive";

afterEach(() => harness.cleanup());

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
    // before the schedule ran would pass for the wrong reason. This was
    // written as a poll for a string that never appears, which is a
    // sleep wearing a poll's clothes -- said plainly now that the poll
    // it borrowed throws when its condition never holds. It is still a
    // guess at how long a tick takes, and the weakest wait in this file.
    await Bun.sleep(200);
    expect((await specsList(base, ARCHIVED_VIEW)).toLowerCase()).not.toContain(STILL_ON_ORIGIN);
  });
});
