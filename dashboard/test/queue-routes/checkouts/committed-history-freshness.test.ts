// Split out of history-and-freshness.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ran, statusSaying } from "../../helpers/queue-server.ts";
import { fakeGit as gitFake } from "../../helpers/fake-git.ts";
import { specControls, phaseDone, OPEN_81, listUntil, dated, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

// Spec 154: the runner owns the record of what has run.
//
// Two incidents on 2026-08-21, in opposite directions. 147's implement
// had RED and GREEN done and every test green, and was killed by the
// step's own time limit before the model reached the part that writes
// `4-status.md` — so the row read "implement not run" about a spec
// whose code was committed on its branch. 153's four files were copied
// from a sibling whose analyze had landed, so a brand-new spec claimed
// three steps and the row offered implement first.
//
// The commits are the record now. The file's line is a claim, and a
// claim the history does not support is said out loud on the row.
describe("spec 154: what has run is what has been committed", () => {
  const specDir = (dir: string) => join(dir, "root", "aide", "specs", "81-queue-and-runner");
  /** Spec 208: every fixture here writes its `4-status.md` and makes
   *  its commits AFTER the server started, and a render reads memory
   *  now. Both of a row's sources have to catch up first — the git side
   *  that dates the folder, and the disk scan that reads what the files
   *  claim — so `settle()` reads both again before the page is asked.
   *
   *  It used to wait 400 ms instead, for the specs-root watcher's own
   *  300 ms debounce to drop the boot-time scan. That left 100 ms of
   *  margin, which a machine running eleven other workers does not
   *  have: the wait ran out with the git side fresh and the disk side
   *  stale, and the row said the two disagreed about a phase that had
   *  run. Waiting for the ROW to stop changing cannot replace it —
   *  half these tests assert that the row says NOTHING, and a stale row
   *  says nothing just as convincingly.
   *
   *  `listUntil` stays as the backstop, and the Started cell is what it
   *  watches: `–` until git can date the folder, a real date once it
   *  can. Bounded, and it falls through with the last answer so a
   *  regression reads as the assertion it broke. */
  const listPage = async (base: string, server: { settle: () => Promise<void> }): Promise<string> => {
    await server.settle();
    return listUntil(base, dated, undefined, "a dated Created cell for the spec");
  };

  // Criterion 1: the 153 incident.
  test("a copied 4-status.md cannot make a fresh spec look analysed", async () => {
    const { base, dir, server } = start();
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze", "implement"]));
    // The folder exists, and nothing has ever run in it.
    ran(dir, []);
    const line = specControls(await listPage(base, server), "81-queue-and-runner");
    // Spec 176: `create` is settled by the folder existing, so it is
    // done here and says nothing about the copy. What spec 153 is the
    // guard for is the two below it.
    expect(phaseDone(line, "create")).toBe(true);
    expect(phaseDone(line, "analyze")).toBe(false);
    expect(phaseDone(line, "implement")).toBe(false);
    // And the phase a press would START at is analyze, not implement:
    // every un-run phase is ticked since spec 200, so the button — which
    // names the first of them — is what tells the two apart.
    expect(line).toMatch(/value="analyze" checked/);
    expect(line).toContain(">Analyze</button>");
  });

  // Criterion 3, the same fixture: the row does not swallow it.
  test("a file claiming a step the history does not have says so on the row", async () => {
    const { base, dir, server } = start();
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze", "implement"]));
    ran(dir, ["create"]);
    const line = specControls(await listPage(base, server), "81-queue-and-runner");
    expect(phaseDone(line, "create")).toBe(true);
    expect(line).toContain("disagree about whether");
  });

});

// Spec 97: a description edited after the analyze ran leaves the plan
// describing an older problem, and the row said nothing. The signal is
// asked of git at render time and never stored, so a re-run clears it
// without anything having to remember it was ever set.
describe("a description newer than the analysis is shown on the row", () => {
  const DESCRIPTION_EDITED = "2026-08-18T09:10:36+02:00";
  const SUBJECT = "Run /aide-analyze for 81-queue-and-runner (headless)";

  /** The specs repo answering for one spec: which steps it has had
   *  (spec 154), when its description was last committed, and what its
   *  analyze history looks like. */
  const gitSaying = (descriptionAt: string, analyzeLog: string, differs = true) =>
    gitFake({
      // The workflow history, first because its argv is the more
      // specific one — the table's first matching prefix wins.
      "log --all --format=%s": {
        code: 0,
        stdout: ["create", "analyze", "implement"]
          .map((step) => `Run /aide-${step} for 81-queue-and-runner (headless)`)
          .join("\n"),
      },
      "log -1 --format=%H": { code: 0, stdout: `deadbee\t${descriptionAt}\n` },
      "log --format=%H%x09%aI%x09%s": { code: 0, stdout: analyzeLog },
      // `git diff --quiet`: 1 means the description says something the
      // analysis never read, 0 means the commit changed nothing.
      "diff --quiet": { code: differs ? 1 : 0 },
    });

  /** A spec whose files agree with the history `gitSaying` reports:
   *  analyze done, and implement too. */
  const analysedSpec = (dir: string): void => {
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    writeFileSync(
      join(spec, "4-status.md"),
      statusSaying(
        ["create", "analyze", "implement"],
        "- **Total progress:** `100% (4 of 4 completed)`\n",
      ),
    );
  };

  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string): string =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";

  /** The badge sits on the analyze phase line and the marks on the step
   *  boxes, and a collapsed row draws neither — so every fetch here
   *  asks for the spec open. */
  const listPage = (base: string) => fetch(`${base}/?${OPEN_81}`).then((r) => r.text());

  test("the analyze line says the description changed since (criterion 1)", async () => {
    const { base, dir } = start({
      gitRun: gitSaying(DESCRIPTION_EDITED, `deadbee\t2026-08-18T08:57:16+02:00\t${SUBJECT}\n`).run,
    });
    analysedSpec(dir);
    const html = await listPage(base);
    expect(subRow(html, "analyze")).toContain("Description changed since");
    expect(subRow(html, "implement")).not.toContain("Description changed since");
  });

  test("analyze stops counting as done (criteria 2, 3)", async () => {
    const { base, dir } = start({
      gitRun: gitSaying(DESCRIPTION_EDITED, `deadbee\t2026-08-18T08:57:16+02:00\t${SUBJECT}\n`).run,
    });
    analysedSpec(dir);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(false);
    // implement is untouched by this check: its own done-mark comes
    // from 4-status.md, and nothing here blocks running it.
    expect(phaseDone(line, "implement")).toBe(true);
    expect(line).toMatch(/value="analyze" checked/);
    // implement has run, so a press does not run it again unticked.
    expect(line).not.toMatch(/value="implement" checked/);
  });

  // Spec 139, criterion 10: the freshness check is a DISPLAY override,
  // derived at render time. It clears the two marks the stale
  // description casts doubt on; it never rewrites the record they came
  // from, so a re-analysis that proves the edit cosmetic restores the
  // marks with nothing having had to remember them.
  test("the stale row leaves the recorded list on disk untouched (spec 139, criterion 10)", async () => {
    const { base, dir } = start({
      gitRun: gitSaying(DESCRIPTION_EDITED, `deadbee\t2026-08-18T08:57:16+02:00\t${SUBJECT}\n`).run,
    });
    analysedSpec(dir);
    const statusPath = join(dir, "root", "aide", "specs", "81-queue-and-runner", "4-status.md");
    const before = readFileSync(statusPath, "utf-8");
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(false);
    expect(readFileSync(statusPath, "utf-8")).toBe(before);
    expect(before).toContain("- **Workflow steps completed:** create, analyze, implement");
  });

});
