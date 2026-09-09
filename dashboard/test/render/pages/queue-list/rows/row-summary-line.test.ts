import { describe, expect, test } from "bun:test";
import {
  renderQueueRows,
  type QueueRowView,
  type QueueTarget,
} from "../../../../../src/render.ts";
import { openKeys, row } from "../../fixtures.ts";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../../../src/project/parse-status.ts";

// Split out of listing-and-units.test.ts by theme.
describe("spec 101: one line per row for what is going on and what is next (criterion 11)", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  // Open: several of these read the button that names the next phase,
  // and since 2026-09-08 that button rides the caption line the fold
  // opens. The head line this describe is about is drawn the same way
  // either way.
  const rows = (list: QueueRowView[], targets: QueueTarget[] = []) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) } },
      Date.parse("2026-08-18T12:00:00Z"),
    );
  // The sentence used to sit in the state cell, under the badge it
  // explained. Spec 174 removed it and the div it filled: the button
  // beside the badge names the phase it would run, so the sentence
  // told a reader to press the control they were looking at. `hint`
  // stays as the reader of that div — it is how these tests say the
  // div is not there.
  const stateCell = (html: string) => {
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
    // The SECOND cell: name, then state. Progress went into the name
    // cell with the pips (2026-08-22).
    return head.split("<td")[2] ?? "";
  };
  const hint = (html: string) =>
    stateCell(html).match(/<div class="muted small">([\s\S]*?)<\/div>\s*<\/td>/)?.[1] ?? "";
  /** Spec 132: the FIRST line — the badge itself. Once nothing is
   *  running it carries the whole sentence, and `hint` above is empty.
   *  The dot comes off first: it is the badge's live mark, not a word. */
  const chip = (html: string) => {
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
    const state = (head.split("<td")[2] ?? "").replace(/<span class="dot"[^>]*><\/span>/g, "");
    return state.match(/<span class="badge b-[a-z]+"[^>]*>([^<]*)<\/span>/)?.[1] ?? "";
  };

  // Spec 174, criteria 1-2: it used to say "never run — tick a phase
  // and press Run", beside a button that already reads "Analyze". The
  // page says what IS; the controls say what can be done.
  test("a spec nothing has run is not told what to press", () => {
    const cell = stateCell(rows([], [target("101-never-run")]));
    expect(cell).not.toContain("press Run");
    expect(cell).not.toContain("tick a phase");
    // The div itself, not only its text: an empty one is a line the
    // row draws and can never fill.
    expect(cell).not.toContain('<div class="muted small">');
    // The badge and the button are untouched — they are what says it.
    // Spec 176 changed the words on a never-run row from "not started"
    // to what comes next; the badge itself is still what says it.
    expect(cell).toContain(">ready<");
  });

  // In flight the sentence says nothing (asked for 2026-08-19): the
  // chip itself reads "analyzing" and the running phase line says the
  // rest — "analyze running — review to follow" was the same fact a
  // third time.
  test("a running job's chip carries the phase word; the sentence stays empty", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["analyze", "implement"], stepIndex: 0, state: "running" })],
      [target("101-a")],
    );
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)![0];
    expect(head).toContain(">analyzing<");
    expect(head).not.toContain("to follow");
    expect(hint(html)).toBe("");
  });

  // Spec 174: "press Run to try implement again" sat directly above a
  // button reading "Implement". The four states keep their badge; the
  // sentence goes.
  test("a job that stopped short is not told how to try again", () => {
    for (const state of ["failed", "stopped", "cancelled", "interrupted"] as const) {
      const cell = stateCell(
        rows([row({ specFolder: "101-a", steps: ["implement"], state })], [target("101-a")]),
      );
      expect(cell).not.toContain("press Run");
      expect(cell).not.toContain('<div class="muted small">');
      // Which of the four it was is still said, in the badge (a
      // cap-stop names its cap there too, hence toContain).
      expect(cell).toContain(state);
    }
  });

  // Spec 132 put the sentence in the badge and had it name WHICH repo
  // was ready to merge. Spec 149 took the naming back out with the
  // button it was for: the badge says what can HAPPEN next instead, and
  // for a branch left open that is the archive step which lands it.
  test("a finished spec with a branch still out says which phase is next", () => {
    const html = rows([row({ specFolder: "101-a", state: "done" })], [target("101-a")]);
    expect(chip(html)).toBe("ready");
    expect(html).toContain(">Analyze</button>");
    expect(hint(html)).toBe("");
  });

  // Spec 111: the fixture had no `done` at all, which under spec 111's
  // rule means "nothing has happened yet" — the opposite of what the
  // test's own name claims. It passed only because the sentence never
  // read the files. Every phase is named here, so "nothing left out"
  // is what the fixture actually says.
  //
  // Spec 191 corrected what it expects: a spec on this list is one the
  // archive has not moved, whatever its history says about the step
  // having run. The badge says archive is what remains; the test's own
  // point — that no merge is asked for — is untouched by that.
  test("a finished spec with nothing left out does not ask for a merge", () => {
    const html = rows(
      [row({ specFolder: "101-a", state: "done" })],
      [target("101-a", { done: ["analyze", "implement", "archive"] })],
    );
    expect(chip(html)).toBe("ready");
    expect(chip(html).toLowerCase()).not.toContain("merge");
    expect(hint(html)).toBe("");
  });

  // --- spec 111: the sentence names the next phase, not "nothing waiting" ---

  // "done" is the JOB's state and is correct for the job. What the
  // sentence beneath it used to say — nothing is waiting on you — was a
  // claim about the SPEC, and the spec's own files already knew better.
  // Same rule as spec 108: the files say what has happened.
  test("a spec whose plan is done is ready for implement", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["analyze"], state: "done" })],
      [target("101-a", { done: ["analyze"] })],
    );
    expect(chip(html)).toBe("ready");
    expect(html).toContain(">Implement</button>");
    expect(chip(html)).not.toBe("done");
    expect(hint(html)).toBe("");
  });

  test("a spec with only archive left says so", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["implement"], state: "done" })],
      [target("101-a", { done: ["analyze", "implement"] })],
    );
    expect(chip(html)).toBe("ready");
    expect(html).toContain(">Archive</button>");
  });

  // An open branch used to outrank the phase that was ready, because
  // merging it was a thing to do. It is not one since spec 149 — the
  // phase that lands it IS the next phase — so the badge says that.
  test("an open branch does not displace the phase that is ready", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["analyze"], state: "done" })],
      [target("101-a", { done: ["analyze"] })],
    );
    expect(chip(html)).toBe("ready");
    expect(html).toContain(">Implement</button>");
    expect(hint(html)).toBe("");
  });

  // Named "still says nothing is waiting" until spec 191, which is the
  // string the fix removes: every phase behind it INCLUDES an archive
  // that ran, and a spec still on this list is one the move did not
  // happen for. Archive is the floor, so archive is what it says.
  test("a spec with every phase behind it is ready for archive", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["archive"], state: "done" })],
      [target("101-a", { done: ["analyze", "implement", "archive"] })],
    );
    expect(chip(html)).toBe("ready");
    expect(html).toContain(">Archive</button>");
    expect(hint(html)).toBe("");
  });

  // The bug as reported, on spec 108, 2026-08-19: the plan run finished,
  // its branch was merged, and the row said nothing waited on a reader
  // while implement had never been started.
  test("a merged plan branch with implement still to run says implement is ready", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["analyze"], state: "done" })],
      [target("101-a", { done: ["analyze"] })],
    );
    expect(chip(html)).toBe("ready");
    expect(html).toContain(">Implement</button>");
    expect(chip(html)).not.toContain("nothing waiting on you");
  });

  // A run that stopped short says which of the four it was, whatever
  // the spec's files say has been done: "ready for X" must not widen
  // into a state that stopped. Until spec 174 the retry sentence below
  // the badge was what this test read; the badge is what carries it now.
  test("a job that stopped short keeps its own badge, whatever the files say", () => {
    for (const state of ["failed", "stopped", "cancelled", "interrupted"] as const) {
      const html = rows(
        [row({ specFolder: "101-a", steps: ["implement"], state })],
        [target("101-a", { done: ["analyze"] })],
      );
      expect(chip(html)).toContain(state);
      expect(chip(html)).not.toContain(">ready<");
      expect(hint(html)).toBe("");
    }
  });

  // Spec 108: archive is the one phase whose "done" the job's own exit
  // status cannot answer, so the sentence reads the file instead.
  test("a spec whose archive run declined says so instead of 'done'", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["archive"], state: "done" })],
      [target("101-a", { archiveHeldBack: { reason: "the Slack webhook" } })],
    );
    // Spec 143: the badge keeps the WORD — it is `nowrap`, and the
    // reason is a sentence — and the row's panel says the reason.
    expect(chip(html)).toBe("stopped");
    expect(chip(html)).not.toContain("nothing waiting on you");
    // Once, not twice: the badge says it, so the line below has nothing
    // left to add (spec 132).
    expect(hint(html)).toBe("");
    expect(html.match(/the Slack webhook/g)).toHaveLength(1);
    expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
      "archive held back: the Slack webhook",
    );
  });

  // Spec 291's own fix (2026-08-31): unticked Acceptance criteria share
  // the archiveHeldBack field a dependency-gated decline uses, but this
  // one is the spec's own ordinary next step, not something waiting on
  // the outside — so the badge reads "ready", not "waiting". Spec 411
  // gives the panel below the same link-carrying shape the pull-request
  // mark already has, which now supersedes the plain reason text
  // (`cell-helpers.ts`'s `liveMarks()` — a row-marks.test.ts describe
  // block pins the mark itself; this test keeps its own eye on the
  // badge beside it).
  test("unticked Acceptance criteria read as ready, not as a decline", () => {
    const html = rows(
      [row({ specFolder: "101-b", steps: ["archive"], state: "done" })],
      [target("101-b", { done: ["implement"], archiveHeldBack: { reason: ACCEPTANCE_CRITERIA_UNTICKED_NOTE } })],
    );
    expect(chip(html)).toBe("ready");
    expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
      "Click the link to start a test server running this branch",
    );
  });

  // Spec 132, criterion 11 said the file's reason on the line below the
  // badge for the four states that stopped short. Spec 143 took it to
  // the row's panel instead — the same sentence, the same four states,
  // in the one place on the row that has the width for it. The line
  // below goes back to saying what to press.
  test("a run that stopped short says the held-back reason in the row's panel", () => {
    for (const state of ["failed", "stopped", "cancelled", "interrupted"] as const) {
      const html = rows(
        [row({ specFolder: "101-a", steps: ["archive"], state })],
        [target("101-a", { archiveHeldBack: { reason: "the Slack webhook" } })],
      );
      expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
        "archive held back: the Slack webhook",
      );
      // Spec 174: and nothing under the badge at all any more.
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

  // Spec 101 asked for the line on EVERY row, so a blank one did not
  // read as a row missing something. Spec 174 took the line off every
  // row instead, which answers the same worry the other way: no row
  // draws it, so none is missing it.
  test("no row draws the line any more", () => {
    const html = rows(
      [row({ specFolder: "101-a", state: "running" })],
      [target("101-a"), target("101-b")],
    );
    // The spec rows only: a phase line has asides of its own in the
    // same class, and those are not what this spec removed.
    const heads = [...html.matchAll(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/g)].map((m) => m[0]);
    expect(heads).toHaveLength(2);
    for (const head of heads) expect(head).not.toContain('<div class="muted small">');
  });
});
