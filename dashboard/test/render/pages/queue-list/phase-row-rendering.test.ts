import { describe, expect, test } from "bun:test";
import {
  renderQueuePage,
  renderQueueRows,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../src/render.ts";
import { row, openKeys } from "../fixtures.ts";

// Split out of row-status-and-controls.test.ts by theme: the rest of
// "a spec's row runs its own phases" that is not about ticking/locking
// a box (that half is phase-box-locking.test.ts) — the gate control,
// the model dropdown, folding, the row's own summary, and the two
// specs about a busy job and the State line.
describe("a spec's row runs its own phases", () => {
  const job = (id: string, step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({ id, specFolder: "94-row-runs-it", steps: [step], stepIndex: 0, state: "done", ...extra });

  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [],
    opts: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-18T12:00:00Z"),
    );

  const page = (opts: Partial<QueuePageOptions> = {}) =>
    renderQueuePage([], "2026-08-18T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "94-never-run" }],
      ...opts,
    });

  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";
  /** The line the run control is on — since spec 109 a `<tr>` of its
   *  own under the header, rather than the header's last cell. */
  const runLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";

  // Spec 133 took the "stop for approval between steps" box out: its
  // two states were "run straight through" and "stop after every step",
  // and the second is reached better by ticking one phase at a time.
  test("no row offers a gate control at all (spec 133, criterion 1)", () => {
    for (const projects of [["aide"], ["aide", "paceup"]]) {
      const html = rows([], [target("94-never-run")], { projects });
      expect(runLine(html, "94-never-run")).not.toBe("");
      expect(html).not.toContain('name="gate"');
      expect(html).not.toContain("data-gate");
    }
  });

  // Since spec 123 the choice is offered once per PHASE, not once per
  // row — but it is still the config that says which models exist. The
  // "default" entry is gone (2026-08-19): the select is pre-filled with
  // a real name instead.
  test("the row offers the configured models, pre-filled and nothing else", () => {
    const html = rows([], [target("94-never-run")], {
      modelChoices: [{ name: "sonnet", budgetUsd: 3 }, { name: "fable", budgetUsd: 12 }],
      defaultModels: { default: "sonnet" },
    });
    const line = subRow(html, "analyze");
    expect(line).toContain('name="model.analyze"');
    expect(line).toContain('value="fable"');
    expect(line).not.toContain('<option value="">');
    expect(line).toMatch(/<option value="sonnet"[^>]*selected/);
  });

  test("with no model configured the row offers no dropdown at all", () => {
    const html = rows([], [target("94-never-run")]);
    expect(runLine(html, "94-never-run")).not.toBe("");
    expect(html).not.toContain('name="model"');
  });

  test("the token rides along when the page carries one", () => {
    const line = runLine(rows([], [target("94-never-run")], { token: "s3cret" }), "94-never-run");
    expect(line).toContain('name="token" value="s3cret"');
  });

  test("a phase line is read-only now — it carries no form of its own", () => {
    const html = rows([job("j1", "analyze")], [target("94-row-runs-it")]);
    for (const phase of ["create", "analyze", "implement", "archive"]) {
      expect(subRow(html, phase)).not.toContain("<form");
      expect(subRow(html, phase)).not.toContain("<button");
    }
  });

  // Spec 94 put the run control on the header row so folding could not
  // take it away; spec 103 retires that premise deliberately. Folding
  // is now what the run control is BEHIND: a collapsed row is a status
  // line, and the row a reader is about to act on is the one they open.
  // Since spec 109 the control opens on a line of its own beneath the
  // header, so a shut row has no such line at all.
  // Spec 103 made folding what the run control was BEHIND. Spec 157
  // takes that half back and keeps the other: the PRESS is on the head
  // row whether the row is open or shut — a reader should never have to
  // open a row to start the thing its own state line just named — and
  // what folding still hides is the CHOOSING, the phase boxes and the
  // model pickers on the lines beneath.
  test("folding hides the phase boxes, never the press itself", () => {
    const shut = rows([], [target("94-never-run")], { filter: {} });
    expect(shut).not.toContain('<tr class="subrow');
    expect(shut).not.toContain('type="checkbox" name="steps"');
    // The phases a press would run travel as hidden fields instead, so
    // a shut row's button posts exactly what its label says.
    expect(head(shut, "94-never-run")).toContain('method="post" action="/api/queue"');
    expect(head(shut, "94-never-run")).toContain('<input type="hidden" name="steps" value="analyze">');
    expect(head(shut, "94-never-run")).toContain(">Analyze</button>");

    const open = rows([], [target("94-never-run")], { filter: { open: "aide/94-never-run" } });
    const line = runLine(open, "94-never-run");
    expect(line).toContain('method="post" action="/api/queue"');
    expect(line).toContain('type="checkbox" name="steps" value="analyze"');
    // The button is in the header row's State cell either way, beside
    // the badge whose sentence it finishes (spec 157).
    expect(head(open, "94-never-run")).toContain(">Analyze</button>");
    // And an OPEN row's form carries no phases of its own: the boxes
    // are the reader's, and a hidden field would outvote them.
    expect(head(open, "94-never-run")).not.toContain('type="hidden" name="steps"');
  });

  // The title and the phase came off the row on 2026-08-21, and the
  // percentage followed them in spec 167: it counted the checkbox rows
  // the implement step ticks, so it read 0 with analyze finished and
  // 90-something the moment implement ended, never
  // anything between — while the pips already say how far the spec has
  // got and the State column says what is happening now.
  // What is left of the spec's own files on this line is what it
  // depends on, and THAT still has to come from this row's own target,
  // which is what this test was written for and still proves. The
  // percentage's absence is proved end to end from a real 4-status.md
  // by queue-routes.test.ts, "a spec's progress stays off its row".
  test("a row's summary comes from its OWN target (criterion 9)", () => {
    const html = rows(
      [job("j1", "analyze")],
      [
        target("94-other", {
          title: "Another spec",
          phase: "Phase 1: RED",
          dependsOn: ["12-other-dep"],
        }),
        target("94-row-runs-it", {
          title: "Row runs it",
          phase: "Phase 2: GREEN",
          dependsOn: ["165-own-dep"],
        }),
      ],
    );
    const line = head(html, "94-row-runs-it");
    expect(line).toContain("depends on: 165");
    expect(line).not.toContain("depends on: 12");
    // No percentage on the row at all any more — neither this spec's
    // nor another's.
    expect(line).not.toContain("% done");
    // Neither spec's title or phase is on the row at all any more.
    expect(line).not.toContain("Row runs it");
    expect(line).not.toContain("Phase 2: GREEN");
    expect(line).not.toContain("Another spec");
    expect(line).not.toContain("Phase 1: RED");
  });

  // Spec 176 overturned this: no phase status belongs on the title
  // line at all. The markers and the State column say how far a spec
  // has got, and a line with nothing to say says nothing.
  test("a spec with no recorded status leaves the line blank (spec 176, criterion 2)", () => {
    const line = head(rows([], [target("94-never-run")]), "94-never-run");
    expect(line).not.toContain("no status recorded yet");
    expect(line).toContain('<div class="spec-title"></div>');
  });

  test("the top form is gone from the page, not merely hidden (criterion 7)", () => {
    const html = page({ projects: ["aide"] });
    expect(html).not.toContain('name="target"');
    expect(html).not.toContain('id="targetdata"');
    expect(html).not.toContain('class="enqueue"');
    expect(html).not.toContain("Run a spec");
  });

  test("a refusal is shown on the page, belonging to no one row (criterion 6)", () => {
    const html = page({ error: "analyze is already queued for this spec" });
    expect(html).toContain('class="refusal rowmsg err"');
    expect(html).toContain("analyze is already queued for this spec");
    // Above the table, so it is read before the row that caused it.
    expect(html.indexOf("refusal")).toBeLessThan(html.indexOf('id="jobrows"'));
  });
});

// --- spec 101: one pass over the page as a whole -----------------------------

// The page was built one row-feature at a time and never looked at
// whole. Three of the six complaints are render-level: a disabled box
// that looks live, a job whose later steps read as free while it holds
// them, and an intro paragraph standing between the title and the list
// on every load.
// Spec 105 widened the rule this block is about: the lock is read off
// the SPEC's state, not off the list of steps the in-flight job happens
// to hold. A job queued as two steps together used to leave a LATER
// step tickable, which promised a press the queue was going to refuse
// anyway.
describe("spec 101: a busy job holds every step on the row (criteria 1-3)", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  // The step boxes belong to the open row (spec 103); which of them a
  // busy job holds is what this block is about.
  const rows = (list: QueueRowView[], targets: QueueTarget[] = []) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) } },
      Date.parse("2026-08-18T12:00:00Z"),
    );
  /** The line an open row reveals under its header, where the phase
   *  boxes have lived since spec 109. */
  const runLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  const box = (line: string, step: string) =>
    line.match(new RegExp(`<label class="phase[^"]*" data-phase="${step}"[^>]*>.*?</label>`))?.[0] ?? "";

  /** One job holding two steps, to exercise the lock across a step
   *  boundary. */
  const pair = (state: QueueRowView["state"], stepIndex = 0): QueueRowView =>
    row({
      specFolder: "101-specs-page-ui-pass",
      steps: ["analyze", "implement"],
      stepIndex,
      state,
    });

  const line = (r: QueueRowView) =>
    runLine(rows([r], [target("101-specs-page-ui-pass")]), "101-specs-page-ui-pass");

  test("a later step of the running job is disabled too, not only the one in flight", () => {
    const l = line(pair("running"));
    // The server would refuse a second job naming EITHER of these
    // (`clashing()` tests the whole job), so the page must not offer
    // one of them as available.
    expect(box(l, "analyze")).toContain("disabled");
    expect(box(l, "implement")).toContain("disabled");
  });

  // Spec 105: the step the job never named is locked too. The queue
  // refuses a second job on a spec that already has one in flight
  // (`clashing()`), whatever steps the two name — so a tickable
  // `archive` beside a running `analyze` was an offer the page could
  // not keep.
  test("a step the running job never held is locked all the same (spec 105)", () => {
    const l = line(pair("running"));
    expect(box(l, "archive")).toContain("disabled");
  });

  test("a queued job holds its steps before it has started any of them", () => {
    const l = line(pair("queued"));
    expect(box(l, "analyze")).toContain("disabled");
    expect(box(l, "implement")).toContain("disabled");
  });

  test("a queued job holds the steps it never named either (spec 105)", () => {
    const l = line(pair("queued"));
    expect(box(l, "archive")).toContain("disabled");
  });

  test("a disabled box says why, on the label the pointer is over", () => {
    const l = line(pair("running"));
    expect(box(l, "analyze")).toContain('title="analyze is running"');
    // The reason is about the JOB, so the step that has not started yet
    // carries the same sentence rather than a blank one.
    expect(box(l, "implement")).toContain('title="analyze is running"');
  });

  test("a step the job never named carries the same reason (spec 105)", () => {
    // One sentence for the whole row: the reader is told what the SPEC
    // is doing, not which steps some job happens to list.
    expect(box(line(pair("running")), "archive")).toContain('title="analyze is running"');
  });

  test("a finished job holds nothing — every box is offerable again", () => {
    const l = line(pair("done", 1));
    for (const step of ["analyze", "implement", "archive"]) {
      expect(box(l, step)).not.toContain("disabled");
      expect(box(l, step)).not.toContain("title=\"analyze");
    }
  });

  test("a job that failed, stopped or was cancelled holds nothing either", () => {
    for (const state of ["failed", "stopped", "cancelled", "interrupted"] as const) {
      const l = line(pair(state, 1));
      expect(box(l, "analyze")).not.toContain("disabled");
      expect(box(l, "implement")).not.toContain("disabled");
    }
  });
});

// --- spec 132: the first line says what is happening, or what is next --------
//
// One rule for the badge, whatever the row is doing: a verb while
// something runs, and the resting state plus the next move when nothing
// does. `done` and `queued` were the two words that carried neither —
// `done` because the sentence disambiguating it sat one line lower, and
// `queued` because nothing said WHICH step was waiting.

describe("spec 132: the State line says what is happening, or what is next", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (list: QueueRowView[], targets: QueueTarget[] = [], opts: Partial<QueuePageOptions> = {}) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, ...opts },
      Date.parse("2026-08-20T12:00:00Z"),
    );
  const chip = (html: string) => {
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
    const state = (head.split("<td")[2] ?? "").replace(/<span class="dot"[^>]*><\/span>/g, "");
    return state.match(/<span class="badge b-[a-z]+"[^>]*>([^<]*)<\/span>/)?.[1] ?? "";
  };
  const actionCell = (html: string) => {
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
    const cells = [...head.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
    return cells[cells.length - 1] ?? "";
  };
  const done = () => row({ id: "j1", specFolder: "132-a", steps: ["implement"], state: "done" });

  // Criteria 8, 9: a queued row said one word and nothing else, while
  // the step it was waiting to run was known all along.
  test("a queued job names the step it is waiting to run", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "132-a", steps: ["implement"], stepIndex: 0, state: "queued" })],
      [target("132-a")],
    );
    expect(chip(html)).toBe("implementing queued");
  });

  // Criterion 1: the one action that used to live outside the panel.
  test("a row whose only offer was Merge now has an empty action cell", () => {
    const cell = actionCell(rows([done()], [target("132-a")]));
    expect(cell).not.toContain("<form");
    expect(cell).not.toContain("/merge");
    expect(cell).not.toContain("<button");
  });

});
