// Split out of history-and-freshness.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ran, statusSaying } from "../helpers/queue-server.ts";
import { fakeGit as gitFake } from "../helpers/fake-git.ts";
import {
  TOKEN,
  specControls,
  phaseDone,
  OPEN_81,
  listUntil,
  dated,
  setupQueueRoutesHarness,
} from "./fixtures.ts";

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
   *  now. Two things have to catch up before the row is the row this
   *  suite is about — the cache schedule has to have seen the git repo
   *  at all, and the filesystem watcher has to have cleared the disk
   *  scan the boot-time tick took — so the page is asked again until
   *  the row stops changing.
   *
   *  The Started cell is the git half's tell: `–` until git can date
   *  the folder, a real date once the repo exists. The stability of the
   *  whole row is the disk half's, since what the file claims differs
   *  per test and there is no one string to wait for. Bounded, and it
   *  falls through with the last answer so a regression reads as the
   *  assertion it broke. */
  const listPage = async (base: string): Promise<string> => {
    // Past the filesystem watcher's own 300 ms debounce (`serve.ts`,
    // `scheduleNotify`), which is what clears the disk scan the
    // boot-time warm took. Waiting for the ROW to stop changing does
    // not do it: the row is stable for those 300 ms, at the old answer.
    await new Promise((r) => setTimeout(r, 400));
    return listUntil(base, dated);
  };

  // Criterion 1: the 153 incident.
  test("a copied 4-status.md cannot make a fresh spec look analysed", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze", "implement"]));
    // The folder exists, and nothing has ever run in it.
    ran(dir, []);
    const line = specControls(await listPage(base), "81-queue-and-runner");
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

  // Spec 176, criterion 3: a spec that appears on the dashboard has
  // been created, so "create not run yet" cannot be true. The folder
  // being on disk is a stronger source than the commit log — a spec
  // written by hand has no `Run /aide-create` commit at all — and the
  // pip has read it that way since spec 167. The phase LINE agrees now.
  test("a spec whose folder exists has had create, whatever git records", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    // Analyze has a commit; create never did.
    ran(dir, ["analyze"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "create")).toBe(true);
    // The create line itself, not the group: the three phases below it
    // genuinely have not run, and say so.
    const createLine = line.match(/<tr class="subrow[^"]*"[^>]*data-step="create">[\s\S]*?<\/tr>/)![0];
    expect(createLine).not.toContain("not run yet");
  });

  // And the claim carries no qualifier of its own: the status file
  // here does not name `create`, which before spec 176 would have been
  // a disagreement the moment `create` was forced into `done`.
  test("forcing create into done invents no disagreement", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["analyze"]));
    ran(dir, ["analyze"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "create")).toBe(true);
    expect(line).not.toContain("the files disagree with what has run");
  });

  // Criterion 3, the same fixture: the row does not swallow it.
  test("a file claiming a step the history does not have says so on the row", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze", "implement"]));
    ran(dir, ["create"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "create")).toBe(true);
    expect(line).toContain("the files disagree with what has run");
  });

  test("and so does a file that has NOT caught up with a step that ran", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create"]));
    ran(dir, ["create", "analyze"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(true);
    expect(line).toContain("the files disagree with what has run");
  });

  test("a file that agrees with the history says nothing at all", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(line).not.toContain("the files disagree with what has run");
  });

  // Criterion 2: the 147 incident. No job in the queue's memory at all
  // — the row is built from the commit alone.
  test("a step killed by the time limit reads as stopped, not as not-run", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze"]);
    ran(dir, ["implement"], "81-queue-and-runner", { stopped: "timeout" });
    const line = specControls(await listPage(base), "81-queue-and-runner");
    const implement =
      line.match(/<tr class="subrow[^"]*"[^>]*data-step="implement">[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(implement).toContain("stopped: timeout");
    expect(implement).not.toContain("not run yet");
    // Stopped is not done: implement is still what the row offers.
    expect(phaseDone(line, "implement")).toBe(false);
    expect(line).toMatch(/value="implement" checked/);
  });

  // Criterion 4.
  test("a completed re-run supersedes the stop before it", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    ran(dir, ["create", "analyze"]);
    ran(dir, ["implement"], "81-queue-and-runner", { stopped: "timeout" });
    ran(dir, ["implement"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "implement")).toBe(true);
    expect(line).not.toContain("stopped: timeout");
    expect(line).toMatch(/value="archive" checked/);
  });

  // Criterion 5: a step run at somebody's keyboard, committed by hand
  // with the subject the four skills now offer.
  test("an interactive commit with no headless marker counts the same", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    ran(dir, ["create", "analyze"], "81-queue-and-runner", { headless: false });
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(true);
  });
});

// Spec 97: a description edited after the analyze ran leaves the plan
// describing an older problem, and the row said nothing. The signal is
// asked of git at render time and never stored, so a re-run clears it
// without anything having to remember it was ever set.
describe("a description newer than the analysis is shown on the row", () => {
  const auth = { headers: { "x-aide-token": TOKEN } };
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
  const listPage = (base: string) => fetch(`${base}/?${OPEN_81}`, auth).then((r) => r.text());

  test("the analyze line says the description changed since (criterion 1)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: gitSaying(DESCRIPTION_EDITED, `deadbee\t2026-08-18T08:57:16+02:00\t${SUBJECT}\n`).run,
    });
    analysedSpec(dir);
    const html = await listPage(base);
    expect(subRow(html, "analyze")).toContain("description changed since");
    expect(subRow(html, "implement")).not.toContain("description changed since");
  });

  test("analyze stops counting as done (criteria 2, 3)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: gitSaying(DESCRIPTION_EDITED, `deadbee\t2026-08-18T08:57:16+02:00\t${SUBJECT}\n`).run,
    });
    analysedSpec(dir);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(false);
    // implement is untouched by this check: its own done-mark comes
    // from 4-status.md, and nothing here blocks running it.
    expect(phaseDone(line, "implement")).toBe(true);
    expect(line).toMatch(/value="analyze" checked/);
    // implement is done, so its box is ticked and locked (spec 267) —
    // never a `name="steps"` box a press could re-submit.
    expect(line).not.toMatch(/name="steps" value="implement"/);
  });

  // Spec 139, criterion 10: the freshness check is a DISPLAY override,
  // derived at render time. It clears the two marks the stale
  // description casts doubt on; it never rewrites the record they came
  // from, so a re-analysis that proves the edit cosmetic restores the
  // marks with nothing having had to remember them.
  test("the stale row leaves the recorded list on disk untouched (spec 139, criterion 10)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
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

  test("a re-analyzed spec is current again (criterion 5)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: gitSaying(
        DESCRIPTION_EDITED,
        [
          `2026-08-18T11:00:00+02:00\t${SUBJECT}`,
          `2026-08-18T08:57:16+02:00\t${SUBJECT}`,
        ].join("\n"),
      ).run,
    });
    analysedSpec(dir);
    const html = await listPage(base);
    expect(html).not.toContain("description changed since");
    const line = specControls(html, "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(true);
  });

  test("a description older than the analysis changes nothing (criterion 4)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: gitSaying("2026-08-18T08:00:00+02:00", `deadbee\t2026-08-18T08:57:16+02:00\t${SUBJECT}\n`).run,
    });
    analysedSpec(dir);
    const html = await listPage(base);
    expect(html).not.toContain("description changed since");
    expect(phaseDone(specControls(html, "81-queue-and-runner"), "analyze")).toBe(true);
  });

  // A git that cannot answer must not put a badge on the page that
  // nothing can ever clear.
  //
  // What it DOES do since spec 154 is leave the phase unmarked: the
  // history is the record, and a history nothing can read proves
  // nothing has run. That direction is deliberate — a spec reading as
  // still having analyze ahead of it is visible, and running the step
  // fixes it, where a mark nothing earned is neither. The file's own
  // claim is still on the row, as the disagreement it now is.
  test("git with no answer marks nothing, and still puts no stale badge up (criteria 8, 10)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: gitFake({}).run,
    });
    analysedSpec(dir);
    // Spec 208: the file's own claim reaches the row off the disk scan,
    // and that scan was taken at boot — before `analysedSpec` wrote.
    // The watcher clears it and the row catches up a tick later.
    const html = await listUntil(base, (h) =>
      specControls(h, "81-queue-and-runner").includes("the files disagree with what has run"),
    );
    expect(html).not.toContain("description changed since");
    const line = specControls(html, "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(false);
    expect(line).toContain("the files disagree with what has run");
  });
});
