import { describe, expect, test } from "bun:test";
import { renderSpecsRows } from "../../../../../src/render";
import { openKeys, row, specTarget, openRowsAt } from "../../fixtures.ts";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../../../src/project/parse-status";

// Split out of listing-and-units.test.ts by theme.
describe("one line per row for what is going on and what is next", () => {
  const target = specTarget;
  // Open: several of these read the button that names the next phase,
  // and since 2026-09-08 that button rides the caption line the fold
  // opens. The head line this describe is about is drawn the same way
  // either way.
  const rows = openRowsAt("2026-08-18T12:00:00Z");
  // The sentence used to sit in the state cell, under the badge it
  // explained. It is gone, and so is the div it filled: the button
  // beside the badge names the phase it would run, so the sentence
  // told a reader to press the control they were looking at. `hint`
  // stays as the reader of that div — it is how these tests say the
  // div is not there.
  const stateCell = (html: string) => {
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>\s*<tr class="specstate"[\s\S]*?<\/tr>/)?.[0] ?? "";
    // By its COLUMN, not its position: the header is two rows now and
    // the chevron has a cell of its own, so counting cells says nothing.
    return head.match(/<td[^>]*data-col="state"[\s\S]*?<\/td>/)?.[0] ?? "";
  };
  const hint = (html: string) =>
    stateCell(html).match(/<div class="muted small">([\s\S]*?)<\/div>\s*<\/td>/)?.[1] ?? "";
  /** The FIRST line — the badge itself. Once nothing is
   *  running it carries the whole sentence, and `hint` above is empty. */
  const chip = (html: string) => {
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>\s*<tr class="specstate"[\s\S]*?<\/tr>/)?.[0] ?? "";
    const state = head.match(/<td[^>]*data-col="state"[\s\S]*?<\/td>/)?.[0] ?? "";
    return state.match(/<span class="badge b-[a-z]+"[^>]*>([^<]*)<\/span>/)?.[1] ?? "";
  };

  // In flight the sentence says nothing (asked for 2026-08-19): the
  // chip itself reads "analyzing" and the running phase line says the
  // rest — "analyze running — review to follow" was the same fact a
  // third time.
  test("a running job's chip carries the phase word; the sentence stays empty", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["analyze", "implement"], stepIndex: 0, state: "running" })],
      [target("101-a")],
    );
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>\s*<tr class="specstate"[\s\S]*?<\/tr>/)![0];
    expect(head).toContain(">Analyzing<");
    expect(head).not.toContain("to follow");
    expect(hint(html)).toBe("");
  });

  // "press Run to try implement again" sat directly above a
  // button reading "Implement". The four states keep their badge; the
  // sentence goes.
  test("a job that stopped short is not told how to try again", () => {
    for (const state of ["failed", "waiting", "cancelled"] as const) {
      const cell = stateCell(
        rows([row({ specFolder: "101-a", steps: ["implement"], state })], [target("101-a")]),
      );
      expect(cell).not.toContain("press Run");
      expect(cell).not.toContain('<div class="muted small">');
      expect(cell).toContain(`>${state[0]!.toUpperCase() + state.slice(1)}<`);
    }
  });

  // The badge does not name WHICH repo was ready to merge, since
  // the button it was for is gone; it says what can HAPPEN next instead, and
  // for a branch left open that is the archive step which lands it.
  test("a finished spec with a branch still out says which phase is next", () => {
    const html = rows([row({ specFolder: "101-a", state: "done" })], [target("101-a")]);
    expect(chip(html)).toBe("Created");
    expect(html).toContain(">Analyze</button>");
    expect(hint(html)).toBe("");
  });

  // The fixture had no `done` at all, which under the files' own
  // rule means "nothing has happened yet" — the opposite of what the
  // test's own name claims. It passed only because the sentence never
  // read the files. Every phase is named here, so "nothing left out"
  // is what the fixture actually says.
  //
  // What it expects: a spec on this list is one the
  // archive has not moved, whatever its history says about the step
  // having run. The badge says archive is what remains; the test's own
  // point — that no merge is asked for — is untouched by that.
  test("a finished spec with nothing left out does not ask for a merge", () => {
    const html = rows(
      [row({ specFolder: "101-a", state: "done" })],
      [target("101-a", { done: ["analyze", "implement", "archive"] })],
    );
    expect(chip(html)).toBe("Implemented");
    expect(chip(html).toLowerCase()).not.toContain("merge");
    expect(hint(html)).toBe("");
  });

  // --- The sentence names the next phase, not "nothing waiting" ---

  // "done" is the JOB's state and is correct for the job. What the
  // sentence beneath it used to say — nothing is waiting on you — was a
  // claim about the SPEC, and the spec's own files already knew better.
  // Same rule: the files say what has happened.
  test("a spec whose plan is done is ready for implement", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["analyze"], state: "done" })],
      [target("101-a", { done: ["analyze"] })],
    );
    expect(chip(html)).toBe("Analyzed");
    expect(html).toContain(">Implement</button>");
    expect(chip(html)).not.toBe("done");
    expect(hint(html)).toBe("");
  });

  test("a spec with only archive left says so", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["implement"], state: "done" })],
      [target("101-a", { done: ["analyze", "implement"] })],
    );
    expect(chip(html)).toBe("Implemented");
    expect(html).toContain(">Archive</button>");
  });

  // An open branch used to outrank the phase that was ready, because
  // merging it was a thing to do. It is not one — the
  // phase that lands it IS the next phase — so the badge says that.
  test("an open branch does not displace the phase that is ready", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["analyze"], state: "done" })],
      [target("101-a", { done: ["analyze"] })],
    );
    expect(chip(html)).toBe("Analyzed");
    expect(html).toContain(">Implement</button>");
    expect(hint(html)).toBe("");
  });

  // It was once named "still says nothing is waiting", which is the
  // string the fix removed: every phase behind it INCLUDES an archive
  // that ran, and a spec still on this list is one the move did not
  // happen for. Archive is the floor, so archive is what it says.
  test("a spec with every phase behind it is ready for archive", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["archive"], state: "done" })],
      [target("101-a", { done: ["analyze", "implement", "archive"] })],
    );
    expect(chip(html)).toBe("Implemented");
    expect(html).toContain(">Archive</button>");
    expect(hint(html)).toBe("");
  });

  // The bug as reported: the plan run finished,
  // its branch was merged, and the row said nothing waited on a reader
  // while implement had never been started.
  test("a merged plan branch with implement still to run says implement is ready", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["analyze"], state: "done" })],
      [target("101-a", { done: ["analyze"] })],
    );
    expect(chip(html)).toBe("Analyzed");
    expect(html).toContain(">Implement</button>");
    expect(chip(html)).not.toContain("nothing waiting on you");
  });

  test("the state mark and title link follow the spec, without a Jobs button (AC-9, AC-10, AC-11, AC-12, AC-13)", () => {
    const withJobsList = [row({ specFolder: "101-a", steps: ["analyze"], state: "done" })];
    const withJobsTargets = [target("101-a", { done: ["analyze"], notVerified: 2 })];
    const withJobs = renderSpecsRows(
      withJobsList,
      { runnerAvailable: true, targets: withJobsTargets, openSpec: {}, filter: { open: openKeys(withJobsList, withJobsTargets) } },
      Date.parse("2026-08-18T12:00:00Z"),
    );
    expect(withJobs).toContain(">Idle<");
    expect(withJobs).toContain('/?q=aide%3A101');
    expect(withJobs).not.toContain(">Jobs</a>");

    const withoutJobsTargets = [target("102-b", { done: ["analyze"] })];
    const withoutJobs = renderSpecsRows(
      [],
      { runnerAvailable: true, targets: withoutJobsTargets, openSpec: {}, filter: { open: openKeys([], withoutJobsTargets) } },
      Date.parse("2026-08-18T12:00:00Z"),
    );
    expect(withoutJobs).not.toContain('/?q=aide%3A102');
  });

  // Archive is the one phase whose "done" the job's own exit
  // status cannot answer, so the sentence reads the file instead.
  test("a finished archive job keeps its held-back reason in the notice", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["archive"], state: "done" })],
      [target("101-a", { archiveHeldBack: { reason: "the Slack webhook" } })],
    );
    // The badge keeps the WORD — it is `nowrap`, and the
    // reason is a sentence — and the row's panel says the reason.
    expect(chip(html)).toBe("Held back");
    expect(chip(html)).not.toContain("nothing waiting on you");
    // Once, not twice: the badge says it, so the line below has nothing
    // left to add.
    expect(hint(html)).toBe("");
    expect(html.match(/the Slack webhook/g)).toHaveLength(1);
    expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
      "Archive held back: the Slack webhook",
    );
  });

  // Unticked Acceptance criteria share
  // the archiveHeldBack field a dependency-gated decline uses, but this
  // one is the spec's own ordinary next step, not something waiting on
  // the outside — so the badge reads "ready", not "waiting". The panel
  // below has the same link-carrying shape the pull-request
  // mark already has, which now supersedes the plain reason text
  // (`row-marks.ts`'s `liveMarks()` — a row-marks.test.ts describe
  // block pins the mark itself; this test keeps its own eye on the
  // badge beside it).
  test("a finished job still offers the branch test server for unticked criteria", () => {
    const html = rows(
      [row({ specFolder: "101-b", steps: ["archive"], state: "done" })],
      [
        target("101-b", {
          done: ["implement"],
          historyDone: ["analyze", "implement"],
          archiveHeldBack: { reason: ACCEPTANCE_CRITERIA_UNTICKED_NOTE },
        }),
      ],
    );
    expect(chip(html)).toBe("Held back");
    expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
      "Click the link to start a test server running this branch",
    );
  });

  // For the four states that stopped short the file's reason is said in
  // the row's panel, not on the line below the badge — the same sentence,
  // in the one place on the row that has the width for it. The line
  // below says what to press.
  test("a run that stopped short says the held-back reason in the row's panel", () => {
    for (const state of ["failed", "waiting", "cancelled"] as const) {
      const html = rows(
        [row({ specFolder: "101-a", steps: ["archive"], state })],
        [target("101-a", { archiveHeldBack: { reason: "the Slack webhook" } })],
      );
      expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
        "Archive held back: the Slack webhook",
      );
      // And nothing under the badge at all any more.
      expect(hint(html)).toBe("");
      expect(stateCell(html)).not.toContain('<div class="muted small">');
      expect(html.match(/the Slack webhook/g)).toHaveLength(1);
    }
  });

  test("a run in flight outranks a stale held-back note from an earlier one", () => {
    const text = hint(
      rows(
        [row({ specFolder: "101-a", steps: ["archive"], state: "running" })],
        [target("101-a", { archiveHeldBack: { reason: "the Slack webhook" } })],
      ),
    );
    // The sentence is empty in flight; what must not happen is the
    // stale note upstaging the retry.
    expect(text).not.toContain("held back");
  });
});
