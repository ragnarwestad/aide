// Split out of history-and-freshness.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ran, statusSaying } from "../../helpers/queue-server.ts";
import { JOB, specControls, phaseDone, OPEN_81, listUntil, rowSaysDone, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

// Spec 108: the FILES say what has happened to a spec — not the queue's
// own record of what it ran. The two used to be unioned, so either one
// being true was enough, which is how an archive job that finished
// without moving anything counted as an archived spec.
// Spec 139: one record says how far a spec has got. The dashboard used
// to GUESS — 2-analysis.md over 400 bytes meant analysed, a "Plan
// review" heading in 3-solution.md meant reviewed, 100% in 4-status.md
// meant implemented. On 2026-08-20 the first of those marked spec 138
// analysed before any analyze had run: its untouched analysis template
// is 693 bytes and carries a placeholder the check did not know. The
// row then offered review-plan, and review-plan ran three times against
// an empty template.
describe("spec 139: the steps a spec has had say so themselves", () => {
  const specDir = (dir: string) => join(dir, "root", "aide", "specs", "81-queue-and-runner");

  test("the recorded list is what the row marks done, and implement is next (criterion 3)", async () => {
    const { base, dir } = start();
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze"]);
    const line = specControls(await listUntil(base, rowSaysDone("analyze")), "81-queue-and-runner");
    expect(phaseDone(line, "create")).toBe(true);
    expect(phaseDone(line, "analyze")).toBe(true);
    expect(phaseDone(line, "implement")).toBe(false);
    expect(line).toMatch(/value="implement" checked/);
    // analyze has run, so a press does not run it again unticked.
    expect(line).not.toMatch(/value="analyze" checked/);
  });

  test("a spec with no status file at all has had nothing, and does not throw (criterion 4)", async () => {
    const { base, dir } = start();
    rmSync(join(specDir(dir), "4-status.md"));
    const line = specControls(await listUntil(base, rowSaysDone("create")), "81-queue-and-runner");
    // Spec 176: the folder is on disk, so `create` happened — whatever
    // git records. The steps this test is the guard for are the other
    // four, which stay correctly not done.
    expect(phaseDone(line, "create")).toBe(true);
    expect(phaseDone(line, "analyze")).toBe(false);
    expect(line).toMatch(/value="analyze" checked/);
  });
});

describe("the spec's own history says what has happened, not the queue's", () => {
  test("a step the queue completed is NOT done while the history says otherwise", async () => {
    const { base, dir } = start();
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    // Analysed already; the status says 95%, so implement is what is
    // still to do.
    writeFileSync(
      join(spec, "4-status.md"),
      statusSaying(["create", "analyze"], "- **Total progress:** `95% (21 of 22 completed)`\n"),
    );
    ran(dir, ["create", "analyze"]);

    let html = await listUntil(base, rowSaysDone("analyze"));
    expect(html).toMatch(/value="implement" checked/);

    // Record a completed implement in the queue's own history, exactly
    // as a finished step does.
    const headers = { "content-type": "application/json", accept: "application/json" };
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST", headers, body: JSON.stringify({ ...JOB, steps: ["implement"] }),
      })
    ).json()) as { job: { id: string } };
    const mirror = JSON.parse(readFileSync(join(dir, "queue.json"), "utf-8")) as Record<string, unknown>[];
    // Finished, not still queued: since spec 105 a spec with a job in
    // flight pre-ticks nothing at all — every box on the row is locked.
    mirror[0].state = "done";
    mirror[0].results = [
      { step: "implement", ok: true, costUsd: 12.34, costMeasured: true,
        terminalReason: "completed", at: "2026-08-16T18:00:00Z" },
    ];
    writeFileSync(join(dir, "queue.json"), JSON.stringify(mirror));
    expect(made.job.id).toBeTruthy();

    // A fresh process reading both: the job's `ok` flag changes nothing.
    // The percentage is still 95, so implement is still what to run.
    const second = start({
      queueMirrorPath: join(dir, "queue.json"),
      projectRoot: join(dir, "root"),
    });
    html = await listUntil(second.base, rowSaysDone("analyze"));
    expect(html).toMatch(/value="implement" checked/);
    // `archive` is ticked here too and always is (spec 200: every phase
    // the spec has left starts ticked), so what says implement is not
    // behind us is the BUTTON — it names the first ticked phase, and
    // would read "Archive" if the queue's own record counted.
    expect(html).toContain(">Implement</button>");
    // And the phase line says the same: a step the queue ran is not a
    // step the spec has HAD.
    expect(phaseDone(specControls(html, "81-queue-and-runner"), "implement")).toBe(false);
  });

  test("the same step IS done once the runner has committed it", async () => {
    const { base, dir } = start();
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    writeFileSync(
      join(spec, "4-status.md"),
      statusSaying(
        ["create", "analyze", "implement"],
        "- **Total progress:** `100% (22 of 22 completed)`\n",
      ),
    );
    ran(dir, ["create", "analyze", "implement"]);

    const html = await listUntil(base, rowSaysDone("implement"));
    expect(phaseDone(specControls(html, "81-queue-and-runner"), "implement")).toBe(true);
    expect(html).toMatch(/value="archive" checked/);
    // The button is named for the phase a press would run (spec 157) —
    // the bare word "Run" went with the again-variant that preceded it.
    expect(html).not.toContain("Run again");
    expect(html).toContain(">Archive</button>");
  });

  // An archived spec is a row, on the chips that ask for one, and never
  // on the view of the active ones.
  test("a spec whose folder has been archived is off the Active view, and on the Archived one", async () => {
    const { base } = harness.start({ archivedSpecs: { "80-already-archived": {} } });
    const active = await (await fetch(`${base}/specs?state=not-archived&${OPEN_81}`)).text();
    expect(active).toContain("81-queue-and-runner");
    expect(active).not.toContain("80-already-archived");
    const archivedView = await (await fetch(`${base}/specs?state=archived`)).text();
    expect(archivedView).toContain("80-already-archived");
  });
});
