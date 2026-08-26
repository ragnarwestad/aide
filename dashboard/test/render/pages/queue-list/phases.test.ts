import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderQueuePage,
  renderQueueRows,
  type JobDetailView,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../src/render.ts";
import { ICON_LOCK } from "../../../../src/render/ui/components.ts";
import {
  generatedAt,
  NAV,
  detail,
  row,
  openKeys,
} from "../fixtures.ts";

// --- spec 94: a spec's phases are ticked and run from its own row ------------

// Two ways in became one. A form above the table queued several steps as
// one gated job for whichever spec its dropdown had selected, and each
// phase line carried its own one-step Run button. Both are gone: the
// spec's own header row carries one checkbox per phase, the model, the
// extras and one Run button that queues everything ticked as a single
// job — and it is on the HEADER row, because folding takes the phase
// lines out of the page entirely.
describe("a spec's row runs its own phases", () => {
  const job = (id: string, step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({ id, specFolder: "94-row-runs-it", steps: [step], stepIndex: 0, state: "done", ...extra });

  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  // The run control belongs to an OPEN row since spec 103, so this
  // block opens every spec it renders unless a test says otherwise —
  // it is about what that control holds, which has not changed.
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
  /** One phase's checkbox and its label, from the row it sits on. */
  const box = (line: string, step: string) =>
    line.match(new RegExp(`<label class="phase[^"]*" data-phase="${step}"[^>]*>.*?</label>`))?.[0] ?? "";

  // Spec 124: a done phase is still left unticked, but the box no
  // longer MARKS it — the phase line's own State column says "done",
  // and saying it twice in two alphabets is what that spec removed.
  test("done phases are left unticked; the next one is pre-ticked (criterion 1)", () => {
    const html = rows(
      [job("j1", "analyze"), job("j2", "implement")],
      [target("94-row-runs-it", { done: ["analyze", "implement"] })],
    );
    const line = runLine(html, "94-row-runs-it");
    expect(box(line, "analyze")).not.toContain("checked");
    expect(box(line, "analyze")).not.toContain('title="already done"');
    expect(box(line, "implement")).not.toContain("checked");
    expect(box(line, "archive")).toContain('value="archive" checked');
    // Nothing is in flight, so no BOX is locked. (The stack's own
    // Approve, Cancel and Merge are disabled — there is no job to
    // approve and no branch to merge — which is spec 124's point:
    // they stand there either way.)
    for (const step of ["analyze", "implement", "archive"]) {
      expect(box(line, step)).not.toContain("disabled");
    }
  });

  // A row that EXISTS is a spec that is not archived (2026-08-21), so
  // `archive` is never counted as done however the history reads —
  // which leaves it as the one phase still pre-ticked here. The two
  // that really did run are not.
  test("with every phase run, only archive is pre-ticked", () => {
    const line = runLine(
      rows(
        [job("j1", "archive")],
        [target("94-row-runs-it", { done: ["analyze", "implement", "archive"] })],
      ),
      "94-row-runs-it",
    );
    for (const step of ["analyze", "implement"]) {
      expect(box(line, step)).not.toContain("checked");
    }
    expect(box(line, "archive")).toContain("checked");
  });

  // Spec 200: a press takes the spec as far as it can go, so every
  // phase that has not run starts ticked. Whether a job has ever run
  // for the spec makes no difference to that — `explore` is outside
  // the phase steps, so a spec that has only explored has the same
  // empty done-set, and the same three ticks, as one nothing has run
  // at all. That distinction used to be two tests here.
  test("a spec nothing has run pre-ticks every phase (criterion 1)", () => {
    const lines = [
      runLine(rows([], [target("94-never-run")]), "94-never-run"),
      runLine(rows([job("j1", "explore")], [target("94-row-runs-it")]), "94-row-runs-it"),
    ];
    for (const line of lines) {
      expect(box(line, "analyze")).toContain('value="analyze" checked');
      expect(box(line, "implement")).toContain('value="implement" checked');
      expect(box(line, "archive")).toContain('value="archive" checked');
    }
  });

  test("pre-ticking never re-ticks a phase already done on disk (criterion 2)", () => {
    // Nothing was ever queued for this spec, but its 2-analysis.md is
    // filled in: `done` is read off the files, not off job history.
    // `analyze` is therefore left alone and the two phases after it are
    // ticked — every phase that has not run, not the next one only.
    const line = runLine(rows([], [target("94-never-run", { done: ["analyze"] })]), "94-never-run");
    expect(box(line, "analyze")).not.toContain("checked");
    expect(box(line, "implement")).toContain('value="implement" checked');
    expect(box(line, "archive")).toContain('value="archive" checked');
  });

  // Criterion 2, as spec 105 rewrote it: the siblings lock too. The
  // rule is read off the spec — one job in flight on it, so no second
  // job from this row — not off the one step that job happens to name.
  test("a phase in flight locks every box on the row, not only its own (criterion 2)", () => {
    for (const state of ["queued", "running"] as const) {
      const line = runLine(
        rows([job("j1", "implement", { state })], [target("94-row-runs-it")]),
        "94-row-runs-it",
      );
      for (const step of ["analyze", "implement", "archive"]) {
        expect(box(line, step)).toContain("disabled");
      }
    }
  });

  // Spec 160 narrowed the rule above, and did not replace it: the tail
  // of a RUNNING job is editable, and everything else on a busy row is
  // as locked as it ever was. `editableSteps` is the server's own
  // answer for which those are — worked out in `queue.ts` against the
  // job as it stands, so the box and the route that takes its tick can
  // never disagree about the boundary.
  test("a later phase's box stays live while the job runs (spec 160, criterion 1)", () => {
    const line = runLine(
      rows(
        [job("j1", "analyze", { state: "running", editableSteps: ["implement", "archive"] })],
        [target("94-row-runs-it")],
      ),
      "94-row-runs-it",
    );
    // The running step and everything behind it: closed, as before.
    expect(box(line, "analyze")).toContain("disabled");
    for (const step of ["implement", "archive"]) {
      expect(box(line, step)).not.toContain("disabled");
      // Never the Run form's: while a job is running, that form's
      // submit target creates a SECOND job and the queue refuses it.
      expect(box(line, step)).toContain('data-post-to="/api/queue/j1/steps"');
      expect(box(line, step)).not.toContain('name="steps"');
    }
  });

  test("a step the server did not name stays locked (spec 160, criterion 9)", () => {
    const line = runLine(
      rows(
        [
          job("j1", "implement", {
            state: "running",
            steps: ["implement", "archive"],
            editableSteps: ["archive"],
          }),
        ],
        [target("94-row-runs-it")],
      ),
      "94-row-runs-it",
    );
    // analyze ranks earlier than the step now running: adding it would
    // run it afterwards, which is not what "a LATER phase" means.
    expect(box(line, "analyze")).toContain("disabled");
    expect(box(line, "analyze")).not.toContain("data-post-to");
    expect(box(line, "archive")).not.toContain("disabled");
  });

  // The window between two steps is under two seconds long and is not a
  // job that is running: the server names no editable step for it, and
  // the row goes back to what it looks like today.
  test("a job merely queued between two steps locks everything (spec 160, criterion 8)", () => {
    const line = runLine(
      rows([job("j1", "analyze", { state: "queued" })], [target("94-row-runs-it")]),
      "94-row-runs-it",
    );
    for (const step of ["analyze", "implement", "archive"]) {
      expect(box(line, step)).toContain("disabled");
      expect(box(line, step)).not.toContain("data-post-to");
    }
  });

  // An editable box still belongs to the row for LOCKING purposes: it
  // names the run form, which is how the page's own script finds every
  // control on a row and disables them together while a press is out.
  // It carries no `name`, so naming that form posts nothing.
  test("an editable box names the run form but posts nothing with it (spec 160)", () => {
    const line = runLine(
      rows(
        [job("j1", "analyze", { state: "running", editableSteps: ["archive"] })],
        [target("94-row-runs-it")],
      ),
      "94-row-runs-it",
    );
    expect(box(line, "archive")).toContain('form="rowrun-aide/94-row-runs-it"');
    expect(box(line, "archive")).not.toContain('name="steps"');
  });

  // --- spec 225: the pickers follow the same rule the boxes do -------------
  //
  // Spec 160 unlocked the boxes for the phases a running job has not
  // reached; the AI and model selects beside them stayed locked on the
  // row-level `busy` alone. They read `editableSteps` now — the
  // server's own answer, the same one the box reads, so a picker and
  // the box on its own line can never disagree about where the tail
  // starts.
  const CHOICES_225 = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "codex-fast", budgetUsd: 5, tool: "codex" as const },
  ];
  /** The two selects on one phase's line, as their opening tags: what
   *  a test about `disabled` and `data-post-to` is actually asking. */
  const pickers = (html: string, step: string) => {
    const line = subRow(html, step);
    return {
      ai: line.match(new RegExp(`<select data-ai="model\\.${step}"[^>]*>`))?.[0] ?? "",
      model: line.match(new RegExp(`<select name="model\\.${step}"[^>]*>`))?.[0] ?? "",
    };
  };

  test("a later phase the job HAS keeps its AI and model pickable (spec 225, criterion 1)", () => {
    const html = rows(
      [
        job("j1", "analyze", {
          state: "running",
          steps: ["analyze", "implement", "archive"],
          editableSteps: ["implement", "archive"],
        }),
      ],
      [target("94-row-runs-it")],
      { modelChoices: CHOICES_225 },
    );
    for (const step of ["implement", "archive"]) {
      const p = pickers(html, step);
      expect([step, p.ai.includes("disabled")]).toEqual([step, false]);
      expect([step, p.model.includes("disabled")]).toEqual([step, false]);
      // The model select is the one that posts: a live pick goes to
      // the running job's own route the moment it is made.
      expect([step, p.model.includes(`data-post-to="/api/queue/j1/model"`)]).toEqual([step, true]);
      // The AI select posts nothing itself, live or not — it writes
      // the model select beside it, and that is what reaches the
      // server.
      expect([step, p.ai.includes("data-post-to")]).toEqual([step, false]);
    }
  });

  test("a phase the job does not have at all is pickable too (spec 225, criterion 2)", () => {
    const html = rows(
      [job("j1", "analyze", { state: "running", editableSteps: ["implement", "archive"] })],
      [target("94-row-runs-it")],
      { modelChoices: CHOICES_225 },
    );
    for (const step of ["implement", "archive"]) {
      const p = pickers(html, step);
      expect([step, p.ai.includes("disabled")]).toEqual([step, false]);
      expect([step, p.model.includes("disabled")]).toEqual([step, false]);
      expect([step, p.model.includes("data-post-to")]).toEqual([step, true]);
    }
  });

  test("the running phase and everything behind it stay locked (spec 225, criterion 3)", () => {
    const html = rows(
      [
        job("j1", "implement", {
          state: "running",
          steps: ["analyze", "implement", "archive"],
          stepIndex: 1,
          editableSteps: ["archive"],
        }),
      ],
      [target("94-row-runs-it")],
      { modelChoices: CHOICES_225 },
    );
    for (const step of ["analyze", "implement"]) {
      const p = pickers(html, step);
      expect([step, p.ai.includes("disabled")]).toEqual([step, true]);
      expect([step, p.model.includes("disabled")]).toEqual([step, true]);
      // The same sentence the boxes carry: why the row will not take a
      // click, not a bare padlock.
      expect([step, p.ai.includes('title="implement is running"')]).toEqual([step, true]);
      expect([step, p.model.includes('title="implement is running"')]).toEqual([step, true]);
      expect([step, p.model.includes("data-post-to")]).toEqual([step, false]);
    }
    const ahead = pickers(html, "archive");
    expect(ahead.ai).not.toContain("disabled");
    expect(ahead.model).not.toContain("disabled");
  });

  // The window between two steps is not a running job: the server names
  // no editable step for it, and the row goes back to locking wholesale.
  test("a job merely queued between two steps locks both pickers (spec 225)", () => {
    const html = rows(
      [job("j1", "analyze", { state: "queued" })],
      [target("94-row-runs-it")],
      { modelChoices: CHOICES_225 },
    );
    for (const step of ["analyze", "implement", "archive"]) {
      const p = pickers(html, step);
      expect([step, p.ai.includes("disabled")]).toEqual([step, true]);
      expect([step, p.model.includes("disabled")]).toEqual([step, true]);
      expect([step, p.model.includes("data-post-to")]).toEqual([step, false]);
    }
  });

  /** Rewritten by spec 145. While a row is busy, a box's tick stopped
   *  meaning "what a fresh press would pre-tick" and started meaning
   *  "this job named this step" — and a job names the step it is
   *  running. What the test was guarding, that nothing stale is posted
   *  back, was never the tick: it is `disabled`, which every box on a
   *  busy row still carries. */
  test("a busy phase posts nothing back, ticked or not", () => {
    const line = runLine(
      rows([job("j1", "analyze", { state: "running" })], [target("94-row-runs-it")]),
      "94-row-runs-it",
    );
    expect(box(line, "analyze")).toContain("disabled");
    // Its own job named it, so it reads as ticked — and since spec 168
    // that is ALL it reads as: the running phase's box looks exactly
    // like every other locked-but-ticked phase behind it, because the
    // "this phase is running" signal moved to the row's pip.
    expect(box(line, "analyze")).toContain('class="phase checked"');
    expect(box(line, "analyze")).not.toContain('class="spin"');
    // The one that is NOT in this job stays untouched by that. It is
    // locked here because the server named no editable step — spec 160
    // is what decides that, and this test is about the tick.
    expect(box(line, "implement")).not.toContain("checked");
    expect(box(line, "implement")).toContain("disabled");
  });

  test("one form per row, posting the spec it belongs to and a box per phase (criterion 3)", () => {
    const line = runLine(rows([], [target("94-never-run")]), "94-never-run");
    expect(line).toContain('method="post" action="/api/queue"');
    expect(line).toContain('name="project" value="aide"');
    expect(line).toContain('name="specFolder" value="94-never-run"');
    // The browser submits checkboxes in document order, so the order
    // the boxes are DRAWN in is the order `steps` arrives in.
    const order = [...line.matchAll(/<input type="checkbox" name="steps" value="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(order).toEqual(["analyze", "implement", "archive"]);
    // The button is named for what a press would run since spec 157 —
    // the FIRST ticked phase and nothing after it, which on a fresh
    // spec is `analyze` however many boxes start ticked behind it.
    expect(line).toContain(">Analyze</button>");
  });

  test("a phase already done can be ticked again — a rerun is the same submission (criterion 4)", () => {
    const line = runLine(
      rows([job("j1", "analyze")], [target("94-row-runs-it", { done: ["analyze"] })]),
      "94-row-runs-it",
    );
    expect(box(line, "analyze")).toContain('name="steps" value="analyze"');
    expect(box(line, "analyze")).not.toContain("disabled");
  });

  test("with only its own project there is nothing to add (criterion 5)", () => {
    const html = rows([], [target("94-never-run")], { projects: ["aide"] });
    expect(runLine(html, "94-never-run")).not.toBe("");
    expect(html).not.toContain('name="extraProjects"');
  });

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
  const at = (label: string) => ({ label, url: `https://example.test/${label}` });
  const done = (branchUrls: { label: string; url: string }[]) =>
    row({ id: "j1", specFolder: "132-a", steps: ["implement"], state: "done", branchUrls });

  // Criterion 10 was about telling the per-repo badge apart from the
  // State chip, which had the same three words in it. The badge is
  // gone; the branch line carries links only.
  test("the branch line carries no badge at all", () => {
    const html = rows([done([at("aide")])], [target("132-a")]);
    const branchLine = html.match(/<span class="branchlist">[\s\S]*?<\/span><\/span>/)?.[0] ?? "";
    expect(branchLine).not.toContain('class="badge');
    expect(branchLine).toContain("aide");
  });

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
    const cell = actionCell(rows([done([at("aide")])], [target("132-a")]));
    expect(cell).not.toContain("<form");
    expect(cell).not.toContain("/merge");
    expect(cell).not.toContain("<button");
  });

});
// --- spec 103: a collapsed row shows status only -----------------------------

// Folding used to remove the four phase LINES and nothing else: the
// collapsed row still carried the phase checkboxes, the model dropdown,
// "more" and the Run button, so a list of collapsed rows was still a
// wall of controls and folding said nothing about what it was FOR.
// A collapsed row now says what the spec IS and what state it is in,
// and offers at most the one thing it needs from the reader right now
// (Approve while a gate waits, Merge while a branch waits). Everything
// else belongs to the expanded row, which is what it always was.
describe("spec 103: a collapsed row shows status only", () => {
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
      { runnerAvailable: true, targets, ...opts },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";
  /** The row's own controls line: since spec 109 the run form and
   *  Cancel are a `<tr>` under the header, not a cell inside it. */
  const controlsLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** Where a row's one button is: the State cell — the head row's
   *  THIRD — since spec 157, open or shut alike. It was the header's
   *  last cell for a shut row and a spanning `stackcell` for an open
   *  one, which is why this used to need the whole row group. */
  const actionCell = (chunk: string) => {
    const headRow = chunk.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? chunk;
    const cells = [...headRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
    return cells[1] ?? "";
  };

  const open = (folder: string) => ({ filter: { open: `aide/${folder}` } });

  // Spec 157 gave the press itself back to the collapsed row — a
  // reader should not have to open a row to start what its state line
  // just named. What folding still takes away is everything that is
  // about CHOOSING: the phase boxes, the model pickers, the other
  // repos. One button, named for what it would run, and nothing else.
  test("a collapsed row carries the press and none of the choosing (criterion 1)", () => {
    const line = head(rows([], [target("103-idle")]), "103-idle");
    expect(line).not.toBe("");
    expect(line).toContain(">Analyze</button>");
    expect(line).not.toContain('type="checkbox"');
    expect(line).not.toContain('name="model"');
    expect(line).not.toContain('name="extraProjects"');
    expect(line).not.toContain('class="more"');
  });

  test("a collapsed row keeps its name, status, pips, started and cost (criterion 1)", () => {
    const line = head(
      rows(
        [row({ id: "j1", specFolder: "103-idle", state: "done", spentUsd: 1.5,
               startedAt: "2026-08-19T09:00:00Z" })],
        [target("103-idle", { title: "Status only", phase: "Phase 3" })],
      ),
      "103-idle",
    );
    expect(line).toContain("103-idle");
    // The title left the row on 2026-08-21 — the folder name is it, in
    // slug form — and the percentage left it in spec 167, so what a
    // collapsed row keeps of the spec's own status is the pips and the
    // badge below.
    expect(line).not.toContain("Status only");
    expect(line).not.toContain("% done");
    // Spec 132: the badge says the resting state — one word since
    // 2026-08-24; the button beside it is what names the next phase.
    expect(line).toContain('class="badge b-ready"');
    expect(line).toContain(">ready<");
    expect(line).toContain('class="pips"');
    expect(line).toContain("$1.50");
  });

  // Spec 132 took Merge back out of the row: the State column already
  // says "ready to merge the code", and acting means opening the panel,
  // the same as every other action a collapsed row does not draw.
  test("a collapsed row with an unmerged branch offers no Merge at all (spec 132)", () => {
    const cell = actionCell(
      controlsLine(
        rows(
          [row({ id: "j1", specFolder: "103-merge", state: "done",
                 branchUrls: [{ label: "aide", url: "https://example.test/c" }] })],
          [target("103-merge")],
        ),
        "103-merge",
      ),
    );
    // The row still offers its own next phase (spec 157) — what it
    // does not offer, in any state, is a way to land the branch.
    expect(cell).not.toContain("/merge");
    expect(cell).not.toContain("Merge");
  });

  // Spec 103 sent a reader to the open row to cancel; spec 157 brings
  // the press back, because the State cell says "implementing" and the
  // one thing to do about that is stop it.
  test("a running collapsed row cancels the step it names (criterion 4)", () => {
    const cell = actionCell(
      controlsLine(rows([row({ id: "j1", specFolder: "103-busy", state: "running" })], [target("103-busy")]),
           "103-busy"),
    );
    expect(cell).toContain('action="/api/queue/j1/cancel"');
    expect(cell).toContain(">Cancel</button>");
    // And nothing else: one control, never two.
    expect(cell.match(/<button/g)).toHaveLength(1);
  });

  // Spec 105, criterion 1b: the branch a previous job left behind does
  // not make a busy row actionable. Merge while a step is still writing
  // to that very branch is the press the queue refuses — the collapsed
  // row offers it no more than the open one does. Cancel stays where
  // spec 103 put it: one click away, by opening the row.
  test("a busy collapsed row with an unmerged branch offers no Merge either (spec 105)", () => {
    for (const state of ["queued", "running"] as const) {
      const cell = actionCell(
        controlsLine(
          rows(
            [row({ id: "j1", specFolder: "103-busy-branch", state,
                   branchUrls: [{ label: "aide", url: "https://example.test/c" }] })],
            [target("103-busy-branch")],
          ),
          "103-busy-branch",
        ),
      );
      expect(cell).not.toContain("mergeform");
      expect(cell).not.toContain("/merge");
      // Cancel and only Cancel, as on the open row.
      expect(cell.match(/<button/g)).toHaveLength(1);
      expect(cell).toContain("/cancel");
    }
  });

  // "Nothing pending" is not the same question since spec 157: a spec
  // with a phase still ahead of it always has a press to offer. And
  // since 2026-08-21 there is always one: a row that exists is a spec
  // that is not archived, so `archive` is what a spec that has run
  // everything else is still waiting for. Criterion 4's empty cell
  // describes a state the list cannot hold — a spec whose archive
  // really finished has no row.
  test("a collapsed row that has run everything still offers Archive (criterion 4)", () => {
    const done = ["analyze", "implement", "archive"];
    const cell = actionCell(controlsLine(rows([], [target("103-idle", { done })]), "103-idle"));
    expect(cell).toContain(">Archive</button>");
    expect(cell).not.toContain('type="checkbox"');
  });

  test("with no open parameter at all, no row draws a phase line (criterion 7)", () => {
    const html = rows(
      [
        row({ id: "j1", specFolder: "103-a", state: "done" }),
        row({ id: "j2", specFolder: "103-b", state: "running" }),
      ],
      [target("103-a"), target("103-b"), target("103-c")],
    );
    // Every row still offers its own one press (spec 157) — what none
    // of them offers is a box to tick or a model to pick.
    expect(html).not.toContain('<tr class="subrow');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('name="model.');
  });

  test("expanding a row reveals every control the page has always had (criterion 5)", () => {
    const html = rows([], [target("103-idle")], {
      ...open("103-idle"),
      projects: ["aide", "paceup"],
      modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
    });
    const line = controlsLine(html, "103-idle");
    expect(line).toContain('<form id="rowrun-aide/103-idle" method="post" action="/api/queue"');
    expect(line).toContain('name="steps" value="analyze"');
    expect(line).toContain(">Analyze</button>");
    // The button is in the header's State cell since spec 157; the
    // boxes are on the phase lines below it.
    expect(actionCell(controlsLine(html, "103-idle"))).toContain(">Analyze</button>");
    expect(
      html.match(/<tr class="subrow[^"]*"[^>]*data-step="analyze">[\s\S]*?<\/tr>/)![0],
    ).toContain('name="steps" value="analyze"');
    // The model went with the rest of them, onto the phase lines it
    // belongs to (spec 123) — still revealed by opening, one per phase.
    expect(html).toContain('name="model.analyze"');
    // Four phase lines, plus the caption line above them.
    expect(html.match(/<tr class="subrow/g)).toHaveLength(5);
  });

  test("an expanded row's forms carry the open key forward (criterion 6)", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "103-running", state: "running" })],
      [target("103-running")],
      open("103-running"),
    );
    // The stack, on the line it leads — an open row's buttons are not
    // in the header cell any more (2026-08-19).
    const line = controlsLine(html, "103-running");
    expect(line).toContain('<input type="hidden" name="view.open" value="aide/103-running">');
    // Cancel is on the controls line the open row reveals (spec 109),
    // carrying the same key. It is the whole of that form since spec
    // 149 — Approve stood beside it until then.
    const cancel = line.match(
      /<form method="post" action="\/api\/queue\/j1\/cancel"[^>]*>.*?<\/form>/,
    )![0];
    expect(cancel).toContain('name="view.open" value="aide/103-running"');
  });

  test("no 'more' disclosure survives, open or shut (criterion 10)", () => {
    for (const html of [
      rows([], [target("103-idle")], { projects: ["aide", "paceup"] }),
      rows([], [target("103-idle")], {
        ...open("103-idle"),
        projects: ["aide", "paceup"],
        modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
      }),
    ]) {
      // Scoped to the list: the "?" popover above it is a `<details>`
      // of its own (spec 113), about how runs work, not about a row.
      const table = html.match(/<table class="list speclist">[\s\S]*<\/table>/)?.[0] ?? "";
      expect(table).not.toBe("");
      expect(table).not.toContain("data-more");
      expect(table).not.toContain('class="more"');
      expect(table).not.toContain("<summary");
    }
  });
});
// --- spec 105: while a spec is busy, its row offers Cancel and nothing else ---

// The row's controls used to be governed step by step: spec 101
// disabled the boxes the in-flight job named, and everything else on
// the row stayed live. Seen on 2026-08-19 on spec 103 — `implement`
// running, its spinner up, and the other three phase boxes still
// tickable, "more" still setting a model for a job that could not be
// started, and a second Run one press away. The queue refuses that
// press ("already running on this spec"), so the row was promising
// what the page could not keep.
//
// ONE rule, read off the SPEC's state: while any job is in flight —
// queued, running, or parked at a gate — the row offers exactly what
// that state allows. Every test here is about an OPENED row, because
// a collapsed one has no phase box, no model and no Run to lock in the
// first place (its narrower promise is in the spec 103 block above).
describe("spec 105: a busy row offers only what its state allows", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (list: QueueRowView[], targets: QueueTarget[] = [], opts: Partial<QueuePageOptions> = {}) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        filter: { open: openKeys(list, targets) },
        projects: ["aide", "paceup"],
        modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
        ...opts,
      },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  /** The line an open row reveals under its header: since spec 109 the
   *  phase boxes, Run and Cancel are here, never in the header's cell —
   *  and since spec 117 the model and "also touches" too. */
  const controlsLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** Where a row's one button is: the State cell — the head row's
   *  THIRD — since spec 157, open or shut alike. It was the header's
   *  last cell for a shut row and a spanning `stackcell` for an open
   *  one, which is why this used to need the whole row group. */
  const actionCell = (chunk: string) => {
    const headRow = chunk.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? chunk;
    const cells = [...headRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
    return cells[1] ?? "";
  };
  const box = (line: string, step: string) =>
    line.match(new RegExp(`<label class="phase[^"]*" data-phase="${step}"[^>]*>.*?</label>`))?.[0] ?? "";
  /** The Run button itself, with whatever attributes it carries. */
  const runBtn = (line: string) => line.match(/<button [^>]*>(?:<[^>]*>)*Run(?: again)?<\/button>/)?.[0] ?? "";

  /** A spec with a job in the given state AND a branch an earlier job
   *  left unmerged — the shape that makes "and nothing else" testable:
   *  there is something to merge, and the row must still not offer it. */
  const spec = (state: QueueRowView["state"], folder = "105-busy") =>
    row({
      id: "j1",
      specFolder: folder,
      steps: ["implement"],
      stepIndex: 0,
      state,
      branchUrls: [{ label: "aide", url: "https://example.test/c" }],
    });

  /** The same open row's controls line — where every lockable control
   *  on it lives (spec 109). */
  const openControls = (r: QueueRowView, folder = "105-busy") =>
    controlsLine(rows([r], [target(folder)]), folder);

  // --- criterion 1: running or queued, Cancel and only Cancel ---------------

  /** One button of the action stack, from its own form. */
  const control = (cell: string, verb: string) =>
    cell.match(new RegExp(`<form method="post" action="/api/queue/j1/${verb}"[\\s\\S]*?</form>`))?.[0] ?? "";

  for (const state of ["queued", "running"] as const) {
    test(`a ${state} spec's opened row offers Cancel, and nothing else it can press (criterion 1)`, () => {
      // Since spec 124 the buttons never come and go — a row's stack is
      // the same buttons throughout, and its STATE says which of them
      // will take a click. Since spec 149 Cancel is the only one in it
      // at all: Approve went with the stop between steps, Merge with
      // the hand merge.
      const cell = actionCell(openControls(spec(state)));
      expect(control(cell, "cancel")).not.toContain("disabled");
      expect(control(cell, "approve")).toBe("");
      expect(control(cell, "merge")).toBe("");
    });
  }

  // --- criterion 2: every phase box locks, with the reason on it -------------

  for (const state of ["queued", "running"] as const) {
    test(`a ${state} spec locks every phase box, not the ones its job named (criterion 2)`, () => {
      const line = openControls(spec(state));
      for (const step of ["analyze", "implement", "archive"]) {
        expect(box(line, step)).toContain("disabled");
        expect(box(line, step)).toContain(`title="implement is ${state === "running" ? "running" : "queued"}"`);
      }
    });
  }

  test("the step being worked reads as ticked; the rest keep their own look (criterion 2)", () => {
    const line = openControls(spec("running"));
    // Since spec 168 the box says only that the job named the step.
    // What says the step is being worked RIGHT NOW is the pip on the
    // row above, which is visible whether the row is open or shut.
    expect(box(line, "implement")).toContain('class="phase checked"');
    expect(box(line, "implement")).not.toContain('class="spin"');
    // Not part of this job, so unticked — inert, but not padlocked
    // (spec 145): the padlock is for a control with nothing else on it
    // to say why it will not take a click.
    expect(box(line, "analyze")).toContain('class="phase default"');
    expect(box(line, "analyze")).not.toContain(ICON_LOCK);
  });

  test("a queued job spins nothing — its own step still reads as ticked (criterion 2)", () => {
    const line = openControls(spec("queued"));
    // The job named `implement` and nothing else. Queued is not yet
    // running, so no box spins — but the tick that was made before Run
    // was pressed is still what the row says (spec 145).
    expect(box(line, "implement")).toContain('class="phase checked"');
    for (const step of ["analyze", "archive"]) {
      expect(box(line, step)).toContain('class="phase default"');
    }
    for (const step of ["analyze", "implement", "archive"]) {
      expect(box(line, step)).not.toContain('class="phase off"');
      expect(box(line, step)).not.toContain(ICON_LOCK);
    }
  });

  /** Spec 145's own case, and spec 142's measurement: all three steps
   *  ticked and started as one job, with two of them not reached yet.
   *  The two said nothing about belonging to the running job — they
   *  were drawn exactly like a step the job never named. */
  test("a step queued behind the running one stays ticked, without the padlock (criterion 2)", () => {
    const line = openControls(
      row({
        id: "j1",
        specFolder: "105-busy",
        steps: ["analyze", "implement", "archive"],
        stepIndex: 0,
        state: "running",
      }),
    );
    // The one being worked, in the same job — since spec 168 it is
    // drawn like the two behind it, and the pip carries the motion.
    expect(box(line, "analyze")).toContain('class="phase checked"');
    expect(box(line, "analyze")).not.toContain('class="spin"');
    for (const step of ["implement", "archive"]) {
      const b = box(line, step);
      expect(b).toContain(`value="${step}" checked`);
      expect(b).toContain("disabled");
      expect(b).toContain('class="phase checked"');
      expect(b).not.toContain('class="phase off"');
      expect(b).not.toContain(ICON_LOCK);
    }
  });

  // --- criterion 3: Run, the model and the "more" fields lock too ------------

  // Run used to stand here greyed out, with the reason in its title —
  // the shape spec 124 needed so a column of buttons could not change
  // width from row to row. Spec 157 draws ONE control per row, and
  // while a job is in flight that control is Cancel: an inert Run
  // beside a live Cancel is exactly the second control this removes.
  test("no Run is drawn at all while the spec is busy (criterion 3)", () => {
    const line = openControls(spec("running"));
    expect(runBtn(line)).toBe("");
    expect(line).not.toMatch(/<button[^>]*form="rowrun/);
    // The old title told the reader to do the exact thing this rule
    // removes; it must not survive anywhere on the row.
    expect(line).not.toContain("tick a phase it does not hold");
    // What the row offers instead names the step it would stop.
    expect(line).toContain(">Cancel</button>");
  });

  test("the model select locks (criterion 3)", () => {
    const html = rows([spec("running")], [target("105-busy")]);
    // The model select is on the phase lines since spec 123; the rule
    // it obeys is this one, unchanged.
    expect(html.match(/<select name="model\.analyze"[^>]*>/)![0]).toContain("disabled");
  });

  // There is no disclosure left to carry the reason on a summary, so
  // each of them says it itself — which is where the promise always
  // actually lived.
  test("each locked field carries the same reason (criterion 3)", () => {
    const html = rows([spec("running")], [target("105-busy")]);
    const line = controlsLine(html, "105-busy");
    expect(html.match(/<select name="model\.analyze"[^>]*>/)![0]).toContain(
      'title="implement is running"',
    );
    expect(box(line, "analyze")).toContain('title="implement is running"');
  });

  // --- criterion 4: a gate offers Approve and Cancel, and locks the rest -----

  // --- criterion 5: a settled spec is the ordinary row it always was ---------

  for (const state of ["done", "failed", "stopped", "cancelled", "interrupted"] as const) {
    test(`a ${state} spec's row is fully interactive again (criterion 5)`, () => {
      const html = rows([spec(state)], [target("105-busy")]);
      const line = controlsLine(html, "105-busy");
      for (const step of ["analyze", "implement", "archive"]) {
        expect(box(line, step)).not.toContain("disabled");
      }
      expect(runBtn(line)).not.toContain("disabled");
      expect(html.match(/<select name="model\.analyze"[^>]*>/)![0]).not.toContain("disabled");
    });
  }

  test("a spec with no job at all is untouched by the rule (criterion 5)", () => {
    const html = rows([], [target("105-never-run")]);
    const line = controlsLine(html, "105-never-run");
    for (const step of ["analyze", "implement", "archive"]) {
      expect(box(line, step)).not.toContain("disabled");
    }
    expect(runBtn(line)).not.toContain("disabled");
    expect(html.match(/<select name="model\.analyze"[^>]*>/)![0]).not.toContain("disabled");
  });

});
// --- spec 109: an expanded row reveals its controls BELOW the header ---------

// Opening a row used to pile the run form, the Approve/Cancel form and
// the Merge button into the header's action cell, on top of whatever
// that cell already offered while shut. (Approve and Merge are gone
// since spec 149; what they did to the layout is why this exists.) The cell has no width of its
// own, so it wrapped — and the header line the reader was scanning
// moved down at the moment they acted on it.
//
// The header is the SAME line now, open or shut: its action cell always
// draws what a collapsed row draws. What opening reveals is a
// full-width row beneath it — the phase boxes, Run, and Cancel — built
// the way the phase lines already are, because a full-width row cannot
// widen a column it is not inside.
describe("spec 109: an expanded row reveals its controls below the header line", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (list: QueueRowView[], targets: QueueTarget[] = [], opts: Partial<QueuePageOptions> = {}) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        projects: ["aide", "paceup"],
        modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
        ...opts,
      },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  const open = (folder: string) => ({ filter: { open: `aide/${folder}` } });

  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";
  /** The line this spec adds: an open row's controls, under the header
   *  rather than inside it — everything an open row offers, since spec
   *  117 folded the rarely-set fields onto it too. */
  const controlsLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** Where a row's one button is: the State cell — the head row's
   *  THIRD — since spec 157, open or shut alike. It was the header's
   *  last cell for a shut row and a spanning `stackcell` for an open
   *  one, which is why this used to need the whole row group. */
  const actionCell = (chunk: string) => {
    const headRow = chunk.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? chunk;
    const cells = [...headRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
    return cells[1] ?? "";
  };

  const branch = [{ label: "aide", url: "https://example.test/c" }];

  /** The two things a header row is ALLOWED to differ by, removed before
   *  the two renders are compared:
   *  1. the fold control itself, which exists to say which way it points
   *     (its class, `aria-expanded`, its title and the `?open=` it links to)
   *  2. the hidden `view.open` a form carries so pressing it keeps the
   *     reader's filter — a field with no width, and one a COLLAPSED row
   *     grows too the moment some OTHER row on the page is opened.
   *  What is left is every visible byte of the line, which is what "the
   *  header never changes when a row is expanded" is about. */
  /** ...and the ACTION CELL, the row's LAST: a shut row offers the one
   *  thing the spec waits on there, an open row offers its whole stack
   *  beside the phase lines instead, so that one cell is deliberately
   *  different open and shut. What must still hold is everything a
   *  reader scans — name, pips, state, started, cost — and it is the
   *  rest of the line that says so. */
  const stable = (line: string) =>
    line
      .replace(/<a class="fold[\s\S]*?<\/a>/, "")
      .replace(/<input type="hidden" name="view\.open"[^>]*>/g, "")
      .replace(/<td[^>]*>[\s\S]*?<\/td><\/tr>$/, "");

  const shutAndOpen = (list: QueueRowView[], targets: QueueTarget[], folder: string) => {
    const shut = stable(head(rows(list, targets), folder));
    const opened = stable(head(rows(list, targets, open(folder)), folder));
    expect(shut).not.toBe("");
    expect(opened).not.toBe("");
    return { shut, opened };
  };

  // --- criterion 1: the header line is the same line, open or shut ----------

  test("an idle spec's header row is byte-identical open or shut (criterion 1)", () => {
    const { shut, opened } = shutAndOpen([], [target("109-idle", { title: "Held still" })], "109-idle");
    expect(opened).toBe(shut);
  });

  for (const state of ["queued", "running"] as const) {
    test(`a ${state} spec's header row is byte-identical open or shut (criterion 1)`, () => {
      const { shut, opened } = shutAndOpen(
        [row({ id: "j1", specFolder: "109-busy", state, branchUrls: branch })],
        [target("109-busy")],
        "109-busy",
      );
      expect(opened).toBe(shut);
    });
  }

  test("a settled spec with an unmerged branch keeps its header line too (criterion 1)", () => {
    const { shut, opened } = shutAndOpen(
      [row({ id: "j1", specFolder: "109-merge", state: "done", branchUrls: branch })],
      [target("109-merge")],
      "109-merge",
    );
    expect(opened).toBe(shut);
  });

  // --- criterion 2: what opening actually reveals ---------------------------

  test("an opened idle row reveals its phase lines, and the button beside its state (criterion 2)", () => {
    const html = rows([], [target("109-idle")], open("109-idle"));
    const line = controlsLine(html, "109-idle");
    expect(line).toContain('name="steps" value="analyze"');
    // Spec 157: the button and the form it posts are in the header's
    // STATE cell; the boxes it posts are on the phase lines under it.
    const cell = actionCell(controlsLine(html, "109-idle"));
    expect(cell).toContain('<form id="rowrun-aide/109-idle" method="post" action="/api/queue"');
    expect(cell).toContain(">Analyze</button>");
    expect(cell).not.toContain('name="steps"');
    expect(line.replace(head(html, "109-idle"), "")).toContain('name="steps" value="analyze"');
  });

  test("a collapsed row emits no controls line at all (criterion 2)", () => {
    expect(rows([], [target("109-idle")])).not.toContain("data-controls");
  });

  // --- criteria 3-5: which control lands on which line ----------------------

  for (const state of ["queued", "running"] as const) {
    test(`a ${state} spec offers Cancel beside its state (criterion 3)`, () => {
      const html = rows(
        [row({ id: "j1", specFolder: "109-busy", state, branchUrls: branch })],
        [target("109-busy")],
        open("109-busy"),
      );
      const cell = actionCell(controlsLine(html, "109-busy"));
      expect(cell).toContain('action="/api/queue/j1/cancel"');
      // Exactly once on the page: the State cell is the one place a
      // row's action is drawn now (spec 157).
      expect(html.match(/action="\/api\/queue\/j1\/cancel"/g)).toHaveLength(1);
    });
  }

  // --- criterion 6: the order of the lines an open row grows ----------------

  test("the header comes first, then the phase lines, with nothing between (criterion 6)", () => {
    const html = rows([], [target("109-idle")], open("109-idle"));
    const at = (s: string) => html.indexOf(s);
    // Spec 117 folded "more" into the controls line rather than leaving
    // a second line under it; spec 124 folded the controls line itself
    // into the header's own cell. An open row is a header and its
    // phases, and nothing else.
    expect(html).not.toContain("data-more");
    expect(html).not.toContain("data-controls");
    expect(at('data-folder="109-idle"')).toBeLessThan(at('<tr class="subrow'));
  });

  // The line those fields lived on is gone (spec 124), and so is the
  // fixed-width cell that replaced it (spec 157). What still has to
  // hold is the thing the width was FOR: nothing a row happens to
  // offer may shove the table sideways. The State cell's badge and
  // button share the page's own `row` container, which wraps — so a
  // long pairing becomes two lines instead of a wider column.
  test("the pairing they moved into wraps rather than widening the table", async () => {
    const { CSS } = await import("../../../../src/render/ui/css.ts");
    expect(CSS).not.toContain("data-more");
    expect(CSS).not.toContain("data-controls");
    expect(CSS).not.toContain("stackcell");
    expect(CSS.match(/\n\.row \{[^}]*\}/)![0]).toContain("flex-wrap: wrap");
  });

  // `.row` on its own is block-level `flex`, which would put the
  // rarely-set fields on a line directly UNDER the run form — the
  // two-line shape spec 117 exists to remove, rebuilt in CSS. They
  // have to sit BESIDE it, which is what `inline-flex` buys.
  test("the rarely-set fields sit beside the run form, not under it (spec 117)", async () => {
    const { CSS } = await import("../../../../src/render/ui/css.ts");
    const rule = CSS.match(/\n\.extra \{[^}]*\}/)![0];
    expect(rule).toContain("display: inline-flex");
    expect(rule).toContain("font-size: var(--fs-s)");
  });
});
// --- spec 108: one rule for what a phase shows -------------------------------

// The row for spec 81 said three things at once: pips and phase lines
// read the JOB HISTORY (a July analysis re-run, cancelled, spoke for an
// analysis that was long since done and merged), the checkbox read the
// files unioned with that same history, and archive read "done" from a
// job that had finished without moving anything.
//
// One rule now, for every phase: the FILES say what has happened, the
// last attempt is a qualifier when it disagrees, and archive says "held
// back" with its reason when a run declined to move the folder.
describe("spec 108: one rule per phase", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (list: QueueRowView[], targets: QueueTarget[]) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) } },
      Date.parse("2026-08-19T12:00:00Z"),
    );
  const head = (html: string) => html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
  /** The Run button's own line, under the header since spec 109. */
  /** Everything one row draws: its header line and, when it is open,
   *  the phase lines under it — where the boxes live since spec 124. */
  const runLine = (html: string) =>
    html.match(/<tr class="[^"]*spechead[\s\S]*?(?=<tr class="[^"]*spechead|<\/tbody>|$)/)?.[0] ?? "";
  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  /** The row's one panel (spec 143), which is where every sentence a
   *  phase used to write under its own badge is said instead (spec 195). */
  const panel = (html: string) => html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "";
  // The pips carry the phase's own reader-facing name as their title,
  // which is how one is told from the next three.
  const pipFor = (html: string, label: string) =>
    head(html).match(new RegExp(`<span class="pip ([a-z]+)" title="${label}"`))?.[1] ?? "";
  // The two phases that CAN be true from the files, for a spec whose
  // only open question is archive.
  const BUILT = ["analyze", "implement"];

  test("a phase the files show done, with no job ever queued, reads done (criterion 1)", () => {
    const html = rows([], [target("108-hand-analysed", { done: ["analyze"] })]);
    expect(pipFor(html, "analyze")).toBe("past");
    const analyze = subRow(html, "analyze");
    expect(analyze).toContain("b-done");
    expect(analyze).not.toContain("not run yet");
    expect(analyze).not.toContain("last re-run");
  });

  // Spec 168 gave `.pip.now` the only motion on the page, so what
  // decides whether a spec HAS a `now` pip is now load-bearing twice
  // over: draw one for a spec with nothing running and the closed row
  // says a phase is alive when none is.
  test("a spec with nothing running has no now pip at all", () => {
    const html = rows([], [target("108-hand-analysed", { done: ["analyze"] })]);
    expect(head(html)).toContain('class="pip ');
    expect(head(html)).not.toContain('class="pip now"');
  });

  test("a cancelled re-run never overturns a finished analysis (criterion 2)", () => {
    const html = rows(
      [row({ id: "recancelled", specFolder: "108-recancelled", steps: ["analyze"], state: "cancelled" })],
      [target("108-recancelled", { done: ["analyze"] })],
    );
    expect(pipFor(html, "analyze")).toBe("past");
    const analyze = subRow(html, "analyze");
    expect(analyze).toContain("b-done");
    // Spec 195: the qualifier is a sentence, and a sentence under a
    // badge makes one phase line taller than the ones beside it. The
    // row's panel says it instead — named for the phase it is about.
    expect(analyze).not.toContain("last re-run cancelled");
    expect(panel(html)).toContain("analyze: last re-run cancelled");
  });

  // Criterion 3's "Run again" wording was retired 2026-08-19, and the
  // bare word "Run" with it (spec 157): the button is named for the
  // phase a press would run, which says what "again" was groping for
  // and cannot be wrong at the edges.
  test("with every phase but archive done the button is named for archive", () => {
    const html = rows([], [target("108-ready", { done: BUILT })]);
    expect(pipFor(html, "archive")).toBe("todo");
    expect(subRow(html, "archive")).toContain("not run yet");
    expect(runLine(html)).not.toContain("Run again");
    expect(runLine(html)).toContain(">Archive</button>");
  });

  test("an archive run that declined reads held back, not done (criterion 4)", () => {
    const html = rows(
      [row({ id: "declined", specFolder: "108-held", steps: ["archive"], state: "done" })],
      [
        target("108-held", {
          done: BUILT,
          archiveHeldBack: { reason: "the Slack webhook (Phase 4, still unchecked)" },
        }),
      ],
    );
    expect(pipFor(html, "archive")).toBe("todo");
    const archive = subRow(html, "archive");
    expect(archive).toContain("held back");
    // Spec 143: the REASON is the row's panel's, said once for the
    // whole row. The phase line keeps the word that is its own answer.
    expect(archive).not.toContain("the Slack webhook (Phase 4, still unchecked)");
    expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
      "the Slack webhook (Phase 4, still unchecked)",
    );
    // The one thing it must never read as, which is what it read as
    // before this spec: an ordinary finished step.
    expect(archive).not.toContain("b-done");
  });

  test("an archive run in flight outranks a stale held-back note (criterion 6)", () => {
    const html = rows(
      [row({ id: "retry", specFolder: "108-retry", steps: ["archive"], state: "running" })],
      [target("108-retry", { done: BUILT, archiveHeldBack: { reason: "the Slack webhook" } })],
    );
    expect(pipFor(html, "archive")).toBe("now");
    expect(subRow(html, "archive")).toContain("b-running");
  });

  test("a finished implement job is not done while the files disagree (criterion 8)", () => {
    const html = rows(
      [row({ id: "lagging", specFolder: "108-lagging", steps: ["implement"], state: "done" })],
      [target("108-lagging", { done: ["analyze"] })],
    );
    expect(pipFor(html, "implement")).toBe("todo");
    const implement = subRow(html, "implement");
    expect(implement).not.toContain("b-done");
    // Never silently hidden — and never on the line either, since spec
    // 195: the row's panel is where the sentence goes, named for the
    // phase it is about.
    expect(implement).not.toContain("the files disagree");
    expect(panel(html)).toContain("implement: last run reported done, but the files disagree");
  });

  test("the job page's Steps tab says held back where the row does (criterion 5)", () => {
    const archiveRun = (extra: Partial<JobDetailView> = {}): JobDetailView =>
      detail({
        id: "job-archive",
        steps: ["archive"],
        state: "done",
        results: [
          {
            step: "archive", ok: true, costUsd: 0.51, costMeasured: true,
            terminalReason: "completed", at: "2026-08-19T10:01:00Z",
          },
        ],
        ...extra,
      });
    const held = renderJobDetailPage(
      archiveRun({ archiveHeldBack: "the Slack webhook (Phase 4, still unchecked)" }),
      generatedAt,
      NAV,
      { tab: "steps" },
    );
    expect(held).toContain("held back — the Slack webhook (Phase 4, still unchecked)");
    expect(held).not.toContain("<td>ok</td>");

    // Without a reason the table is exactly what it always was.
    const plain = renderJobDetailPage(archiveRun(), generatedAt, NAV, { tab: "steps" });
    expect(plain).toContain("<td>ok</td>");
    expect(plain).not.toContain("held back");
  });
});
// --- spec 114: a spec with an unmerged dependency says so on the row ---------

// Spec 114 put a badge here — "after 106", one per dependency whose
// branch was still unmerged — so the row said what it was waiting on.
// Taken out again 2026-08-20: the title line already says "depends on
// <folder>" (spec 110) one cell to the left, and the two stood side by
// side saying nearly the same words about the same fact. The state cell
// is the sentence and nothing else again.
describe("a dependency is named once, on the title line, and not in the state cell", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (list: QueueRowView[], targets: QueueTarget[] = []) =>
    renderQueueRows(list, { runnerAvailable: true, targets }, Date.parse("2026-08-19T12:00:00Z"));
  const rowHtml = (html: string, folder: string) =>
    html.match(
      new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?</tr>`),
    )?.[0] ?? "";
  const hintCell = (html: string, folder: string) =>
    (rowHtml(html, folder).split("<td")[3] ?? "").match(
      /<div class="muted small">([\s\S]*?)<\/div><\/td>/,
    )?.[1] ?? "";
  const unmerged = (specFolder: string) =>
    row({
      specFolder,
      state: "done",
      branchUrls: [{ label: "aide", url: "https://example.test/aide" }],
    });

  test("an unmerged dependency puts nothing in the state cell", () => {
    const html = rows([unmerged("106-x")], [target("106-x"), target("114-b", { dependsOn: ["106"] })]);

    expect(hintCell(html, "114-b")).not.toContain("after");
    // The whole cell is the sentence, and nothing else.
    expect(hintCell(html, "114-b")).toMatch(/^[^<]*$/);
  });

  test("the title line still says what the spec builds on", () => {
    const html = rows([unmerged("106-x")], [target("106-x"), target("114-b", { dependsOn: ["106"] })]);

    expect(rowHtml(html, "114-b")).toContain("depends on: 106");
  });
});

// A spec made from the New-spec form starts life as a `create` job — a
// claude run that costs money and can fail — and that run used to be
// findable only by knowing the job id, or appended after `archive` as a
// straggler. It is the spec's FIRST phase, and every spec has had one,
// whether or not the queue ran it.
describe("spec 116: create is the first phase line", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const createJob = (specFolder: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({
      id: "c1",
      specFolder,
      steps: ["create"],
      stepIndex: 0,
      state: "done",
      startedAt: "2026-08-19T10:00:00Z",
      ...extra,
    });
  const rows = (list: QueueRowView[], targets: QueueTarget[]) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) } },
      Date.parse("2026-08-19T12:00:00Z"),
    );
  const head = (html: string) => html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
  /** Everything one row draws: its header line and, when it is open,
   *  the phase lines under it — where the boxes live since spec 124. */
  const runLine = (html: string) =>
    html.match(/<tr class="[^"]*spechead[\s\S]*?(?=<tr class="[^"]*spechead|<\/tbody>|$)/)?.[0] ?? "";
  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  const order = (html: string) => [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
  const pipFor = (html: string, label: string) =>
    head(html).match(new RegExp(`<span class="pip ([a-z]+)" title="${label}"`))?.[1] ?? "";
  /** Every pip's title, in order — the only way to prove one is ABSENT. */
  const pipTitles = (html: string) =>
    [...head(html).matchAll(/<span class="pip [a-z]+" title="([^"]+)"/g)].map((m) => m[1]);

  // --- criterion 1: five lines, create first ---------------------------------

  test("a spec with no job at all leads with create (criterion 1)", () => {
    const html = rows([], [target("116-hand-made", { done: ["create", "analyze"] })]);
    expect(order(html)).toEqual(["create", "analyze", "implement", "archive"]);
  });

  // --- criterion 2: no create job means an inert line, not a missing one -----

  test("a hand-made spec's create line reads done, with nothing to RUN (criterion 2)", () => {
    // "Nothing to run" now includes a box that is ticked and
    // disabled (2026-08-21): it is the line saying the phase is behind
    // you, in the same shape the other four use, and it takes no click.
    //
    // Spec 237 left one thing on the line that IS a click: the name,
    // which opens the Description tab. No job ever ran create here — the
    // folder was made by hand — and the tab is the spec's rather than a
    // run's, so it is there to open all the same.
    const html = rows([], [target("116-hand-made", { done: ["create", "analyze"] })]);
    const line = subRow(html, "create");
    expect(line).toContain("b-done");
    expect(line).not.toContain("<form");
    expect(line).not.toContain("<button");
    expect(line).not.toContain("not run yet");
    // No model note, no elapsed time, no cost — what a finished attempt
    // fills and an attempt-less line leaves empty. Since spec 123 the
    // model shares the phase name's own cell rather than having one of
    // its own, so the emptiness is inside that cell.
    // The name leads the first cell since spec 165 — wrapped in the
    // mobile fold control since 2026-08-24, which is inert on desktop —
    // and the box moved in beside the model. `create`'s box is ticked,
    // disabled and nameless: the folder being on disk IS its answer,
    // and a line with no box at all read as a different KIND of line.
    expect(line).toMatch(
      new RegExp(
        `<td class="phasecell"><label class="phasefold">[\\s\\S]*?` +
          `<a href="/specs/aide/116-hand-made\\?tab=description">create</a></label></td>`,
      ),
    );
    expect(line).toContain(
      '<label class="phase checked" data-phase="create">' +
        '<input type="checkbox" value="create" checked disabled ' +
        'aria-label="create — already done, and not a step you can run"> ' +
        "<span></span></label>",
    );
    expect(line).toContain(
      '<td><span class="badge b-done">done</span></td>' +
        '<td data-col="started"></td><td class="num" data-col="cost"></td>',
    );
  });

  // --- criteria 3-4: a real create job, before and after it lands ------------

  test("an unlanded create job's line reads the job's own state (criterion 3)", () => {
    // No target: the folder is what the job is still making, so the
    // files cannot say create has happened.
    const html = rows([createJob("116-landing", { state: "running" })], []);
    expect(order(html)).toEqual(["create", "analyze", "implement", "archive"]);
    const line = subRow(html, "create");
    expect(line).toContain("running");
    expect(line).not.toContain("b-done");
  });

  test("a landed create job's line reads done and links to the description (criterion 4)", () => {
    const html = rows(
      [createJob("116-landed", { model: "sonnet", spentUsd: 0.42 })],
      [target("116-landed", { done: ["create", "analyze"] })],
    );
    expect(order(html)[0]).toBe("create");
    const line = subRow(html, "create");
    // Spec 237: create's own file is `1-description.md`, so its line
    // opens the Description tab rather than the run's page.
    expect(line).toContain('href="/specs/aide/116-landed?tab=description"');
    expect(line).toContain("b-done");
    // The model it ran on shows as the select's pre-filled value when
    // choices are configured — no spelled-out text since 2026-08-19,
    // so without a picker the line simply says nothing about it.
    expect(line).not.toContain("last ran");
    expect(line).toContain("$0.42");
  });

  // --- criterion 5: a fifth pip, past because the spec exists ----------------
  //
  // Create had no pip from spec 116 until spec 167: the glance was about
  // the four phases a reader can still run. The hole made create read as
  // a different kind of thing rather than as the phase already behind
  // you — the same reason the phase LINE got a box on 2026-08-21 — so it
  // is a pip like the other four now.
  //
  // It cannot simply be un-filtered. `done` comes from the git history,
  // which counts only `Run /aide-<step> for <folder>` commits, and a
  // spec written by hand has no create commit — every one of those would
  // show a grey pip. The rule is the box's rule: a spec that exists was
  // created, so the pip is past unless a create job is running right
  // now.

  test("create is a past pip once the spec exists, with or without a create commit", () => {
    const withJob = rows(
      [createJob("116-landed")],
      [target("116-landed", { done: ["create", "analyze"] })],
    );
    // The hand-written spec is the case `done` cannot answer: no create
    // commit, so `wordPhase`'s ordinary rule would call it "todo".
    const handMade = rows([], [target("116-hand-made", { done: ["analyze"] })]);
    for (const html of [withJob, handMade]) {
      expect(pipTitles(html)).toEqual(["create", "analyze", "implement", "archive"]);
      expect(pipFor(html, "create")).toBe("past");
    }
  });

  test("create is the running pip while a create job is in flight", () => {
    const html = rows(
      [createJob("116-landing", { state: "running" })],
      [target("116-landing")],
    );
    expect(pipFor(html, "create")).toBe("now");
  });

  // --- criterion 6: history, not a control -----------------------------------

  test("create is never a run-form checkbox (criterion 6)", () => {
    const html = rows(
      [createJob("116-landed")],
      [target("116-landed", { done: ["create", "analyze"] })],
    );
    const line = runLine(html);
    const boxes = [...line.matchAll(/<input type="checkbox" name="steps" value="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(boxes).toEqual(["analyze", "implement", "archive"]);
  });

  // --- criterion 7: the status sentence and the button do not move -----------

  test("neither the next-phase sentence nor the Run button notices create (criterion 7)", () => {
    // The same spec twice, differing only in whether create is done. A
    // finished job, so the sentence is the one that names the phase the
    // spec is ready for — "ready for create" is what a widened
    // `QUEUE_STEPS` would produce here, and must not.
    const analyzed = row({ id: "a1", specFolder: "116-status", steps: ["analyze"], state: "done" });
    const withCreate = rows([analyzed], [target("116-status", { done: ["create", "analyze"] })]);
    const withoutCreate = rows([analyzed], [target("116-status", { done: ["analyze"] })]);
    // Spec 132: the sentence is the badge itself once the job is at
    // rest. The dot comes off first — it is the badge's live mark.
    const said = (html: string) =>
      head(html)
        .replace(/<span class="dot"[^>]*><\/span>/g, "")
        .match(/<span class="badge b-[a-z]+"[^>]*>([^<]*)<\/span>/)?.[1] ?? "";
    expect(said(withCreate)).toBe(said(withoutCreate));
    expect(said(withCreate)).toBe("ready");
    // The button is named for the phase a press would run (spec 157),
    // and `create` is not one of them whether it is done or not.
    expect(runLine(withCreate)).toContain(">Implement</button>");
    expect(runLine(withoutCreate)).toContain(">Implement</button>");
    // And with everything built it names archive — never "create", and
    // never the again-variant that went 2026-08-19.
    const allBuilt = rows([analyzed], [target("116-status", { done: ["analyze", "implement"] })]);
    expect(runLine(allBuilt)).not.toContain("Run again");
    expect(runLine(allBuilt)).toContain(">Archive</button>");
  });

  // --- criterion 8: once, at the front, never twice --------------------------

  test("a create job appears once, never also appended after archive (criterion 8)", () => {
    const html = rows(
      [createJob("116-landed"), row({ id: "a1", specFolder: "116-landed", steps: ["analyze"], state: "done" })],
      [target("116-landed", { done: ["create", "analyze"] })],
    );
    expect(order(html)).toEqual(["create", "analyze", "implement", "archive"]);
    expect(html.match(/data-step="create"/g)).toHaveLength(1);
  });
});

// --- spec 254: a landed step reads busy until its branch actually lands -------
//
// `Runner.complete()` writes `state: "done"` and `landing: true` in the
// same update — the merge into the default branch has not happened yet.
// A row that reads `state` alone sees "done" the instant the step
// finishes, well before the merge settles, and offers "ready" with a
// Run/Analyze button for a spec whose files do not exist yet.
describe("spec 254: a step still landing reads busy, not ready", () => {
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
      { runnerAvailable: true, targets, ...opts },
      Date.parse("2026-08-26T12:00:00Z"),
    );
  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";
  /** The row's own controls line: since spec 109 the run form and
   *  Cancel are a `<tr>` under the header, not a cell inside it. */
  const controlsLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** Where a row's one button is: the State cell — the head row's
   *  THIRD — since spec 157, open or shut alike. */
  const actionCell = (chunk: string) => {
    const headRow = chunk.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? chunk;
    const cells = [...headRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
    return cells[1] ?? "";
  };

  // Criterion 1: a create job whose result has just arrived
  // (`state: "done"`) but whose `landBranch()` merge has not yet
  // resolved (`landing: true`) — the row must read busy, the same as a
  // genuinely running job, and offer Cancel rather than Analyze.
  test("a job done but still landing reads busy and offers Cancel, not Analyze (criterion 1)", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "254-landing", steps: ["create"], stepIndex: 0, state: "done", landing: true })],
      [target("254-landing")],
    );
    const line = head(html, "254-landing");
    expect(line).toContain('class="badge b-running"');
    expect(line).toContain("creating");
    expect(line).not.toContain('class="badge b-ready"');
    const cell = actionCell(controlsLine(html, "254-landing"));
    expect(cell).toContain(">Cancel</button>");
    expect(cell).not.toContain(">Analyze</button>");
  });

  // Criterion 4, the regression guard: once `landing` has cleared (the
  // ordinary, already-correct case today), the row is exactly what it
  // is today — no visible change for the settled state.
  test("a job done and no longer landing reads ready, as before (criterion 4)", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "254-landed", steps: ["create"], stepIndex: 0, state: "done", landing: false })],
      [target("254-landed")],
    );
    const line = head(html, "254-landed");
    expect(line).toContain('class="badge b-ready"');
    expect(line).not.toContain('class="badge b-running"');
    const cell = actionCell(controlsLine(html, "254-landed"));
    expect(cell).toContain(">Analyze</button>");
    expect(cell).not.toContain(">Cancel</button>");
  });
});

// --- spec 157: one action beside the state, and the phases hard left ---------
//
// The first column of a row has never settled. Spec 124 gave the
// buttons a column of their own, which pushed the whole table sideways;
// 2026-08-19 moved the stack into the spec column, leading one phase
// line and spanning the rest. Spec 149 then took Merge and Approve
// away, and spec 171 took Resolve; what is left — Run and Cancel — is
// never two things
// at once. So the row draws ONE control, in the State column, right
// after the sentence it completes ("archive held back · Implement"),
// and the phase lines take the left edge the stack vacated.
//
// The button is named for the first TICKED phase, not for the state's
// own suggestion, so a reader can see the two disagree before pressing.
describe("spec 157: the row's one action sits in the State column", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [target("157-one-action")],
    o: { open?: boolean } & Partial<QueuePageOptions> = {},
  ) => {
    const { open = false, ...opts } = o;
    return renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        projects: ["aide"],
        ...(open ? { filter: { open: openKeys(list, targets) } } : {}),
        ...opts,
      },
      Date.parse("2026-08-21T12:00:00Z"),
    );
  };
  const headRow = (html: string) => html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
  const cells = (tr: string): string[] =>
    [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
  /** The State column: the head row's third cell, which is where spec
   *  143 pinned it and where the action now joins the badge. */
  const state = (html: string) => cells(headRow(html))[1] ?? "";
  /** What the row's one control SAYS. `<button>` for Run, and the
   *  component-built one for Cancel, whose label sits
   *  after a `<span class="lbl">`-free plain text node. */
  const labels = (cell: string) => [...cell.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
  const BUILT = ["analyze"];
  const ALL = ["analyze", "implement", "archive"];
  const lead = (extra: Partial<QueueRowView> = {}) =>
    row({ id: "j1", specFolder: "157-one-action", steps: ["analyze"], state: "done", ...extra });

  // --- criteria 1, 2, 3: the button is named for what is ticked -------------

  for (const open of [true, false]) {
    test(`the next unstarted phase names the button (${open ? "open" : "shut"}, criterion 1)`, () => {
      const html = rows([lead()], [target("157-one-action", { done: BUILT })], { open });
      expect(state(html)).toContain(">ready<");
      expect(labels(state(html))).toEqual(["Implement"]);
    });
  }

  test("a fresh spec's pre-ticked phase names the button (criterion 2)", () => {
    const html = rows([]);
    // Spec 176: the badge names the next phase here as it does on a
    // row that has run something, so it agrees with the button beside
    // it rather than saying nothing.
    expect(state(html)).toContain(">ready<");
    expect(labels(state(html))).toEqual(["Analyze"]);
  });

  // Spec 176, criterion 5: the case a hardcoded "not started" got
  // wrong. A spec whose analyze ran long enough ago that its job
  // record has aged out of the queue is `g.lead === undefined` with
  // `analyze` already in `g.done` from git — and the
  // button beside the badge already read "Implement".
  test("a spec with no job left in memory still says what comes next (spec 176)", () => {
    const html = rows([], [target("157-one-action", { done: BUILT })]);
    expect(state(html)).toContain('class="badge b-ready"');
    expect(state(html)).toContain(">ready<");
    expect(state(html)).not.toContain("not started");
    expect(labels(state(html))).toEqual(["Implement"]);
  });

  // Criterion 3 said a spec with nothing ticked draws no button. Since
  // 2026-08-21 a listed spec always has `archive` ticked — the row
  // exists, so the spec is not archived — and the no-button branch is
  // reachable only where the row is busy or conflicted, both of which
  // draw a control of their own. What survives of the criterion is the
  // rule beneath it: the button names what a press would run.
  test("a spec that has run everything is offered Archive (criterion 3)", () => {
    const html = rows([lead()], [target("157-one-action", { done: ALL })]);
    expect(labels(state(html))).toEqual(["Archive"]);
  });

  // The label is the reader's own tick, not the state's suggestion, so
  // a mismatch is visible in the same line rather than after a press.
  test("a phase ticked ahead of the state's suggestion names the button", () => {
    // `done` is empty and a lead job exists, so `preTicked` is the
    // single next phase — the state and the label agree here. The
    // disagreement this spec makes visible is the other direction: a
    // spec whose files say analyze is next but whose archive was held
    // back reads "archive held back · Analyze".
    const html = rows(
      [lead({ steps: ["archive"] })],
      [target("157-one-action", { done: BUILT, archiveHeldBack: { reason: "the tree is dirty" } })],
    );
    expect(state(html)).toContain("archive held back");
    expect(labels(state(html))).toEqual(["Implement"]);
  });

  // --- criteria 4, 5: Cancel names the step it would stop -------------------

  for (const open of [true, false]) {
    test(`a running spec offers Cancel by name (${open ? "open" : "shut"}, criteria 4, 5)`, () => {
      const html = rows(
        [lead({ steps: ["implement"], stepIndex: 0, state: "running" })],
        [target("157-one-action", { done: BUILT })],
        { open },
      );
      expect(labels(state(html))).toEqual(["Cancel"]);
      expect(state(html)).toContain('action="/api/queue/j1/cancel"');
      expect(state(html)).not.toContain(">Resolve<");
      // No Run button. The run FORM may still be there on an open row
      // — it is the carrier the phase boxes name — but nothing submits
      // it while a job is in flight.
      expect(state(html)).not.toMatch(/<button[^>]*form="rowrun/);
    });
  }

  test("a queued implement cancels by the reader's own word", () => {
    const html = rows(
      [lead({ steps: ["analyze", "implement"], stepIndex: 1, state: "queued" })],
      [target("157-one-action", { done: [] })],
    );
    expect(labels(state(html))).toEqual(["Cancel"]);
  });

  // --- criterion 8: a shut row's Run carries its phases as hidden fields ----

  // Every phase the spec has left, in `QUEUE_STEPS` order (spec 200):
  // a shut row's press runs what an open row's pre-ticked boxes would,
  // and the two read the same `preTicked()` set to say so.
  test("a shut row's run form carries the ticked phases as hidden inputs (criterion 8)", () => {
    const html = rows([]);
    const posted = [...state(html).matchAll(/<input type="hidden" name="steps" value="([^"]+)">/g)].map(
      (m) => m[1],
    );
    expect(posted).toEqual(["analyze", "implement", "archive"]);
  });

  // An OPEN row has real checkboxes, and they are the only source of
  // `steps`: a hidden field beside them would post every phase twice
  // and outvote a reader who unticked one (criterion 12).
  test("an open row's run form carries no steps of its own (criterion 12)", () => {
    const html = rows([], [target("157-one-action")], { open: true });
    expect(state(html)).not.toContain('name="steps"');
    expect(html).toContain('<input type="checkbox" name="steps" value="analyze"');
  });

  // --- criterion 14: the phase lines take the left edge ---------------------

  test("no stack cell survives anywhere, open or shut (criterion 14)", () => {
    for (const open of [true, false]) {
      expect(rows([], [target("157-one-action")], { open })).not.toContain("stackcell");
    }
  });

  test("the phase line leads with its own cell, and still fills the table (criterion 14)", () => {
    const html = rows([], [target("157-one-action")], {
      open: true,
      modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
    });
    const subs = [...html.matchAll(/<tr class="subrow[^"]*"[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
    for (const sub of subs) {
      expect([sub.slice(0, 60), sub.indexOf('<td class="phasecell">')]).toEqual([
        sub.slice(0, 60),
        sub.indexOf("<td"),
      ]);
      // The same count on EVERY phase line since spec 179 put a picker
      // on each of them: no line borrows a slot from a `rowspan` on
      // the line above it any more.
      expect([sub.slice(0, 60), cells(sub).length]).toEqual([sub.slice(0, 60), 5]);
    }
  });

  // The phase's own state word stays under the State header, where the
  // spec's badge is: the same question at two altitudes, in one column.
  test("the phase's state word stays in the State column", () => {
    const html = rows([lead()], [target("157-one-action", { done: BUILT })], { open: true });
    const analyze = html.match(/<tr class="subrow[^"]*" data-step="analyze">[\s\S]*?<\/tr>/)![0];
    // The third cell: the phase's name, the cell holding its three
    // controls, then the state word. The Progress column stood between
    // them until 2026-08-22, when the pips moved in beside the spec's
    // name and the column went.
    expect(cells(analyze)[2]).toContain('class="badge b-done"');
    expect(cells(analyze)[1]).toContain('data-phase="analyze"');
  });

  // A shut row's action left the last column for the State column in
  // spec 157, and nothing took its place: the column stood blank on
  // every row for as long as the header declared it, and went on
  // 2026-08-23. The row ends on Cost now, whatever the state.
  test("the head row ends on the cost cell whatever the state", () => {
    for (const r of [[], [lead()], [lead({ state: "running" })], [lead({ errorReason: "conflict" })]]) {
      const row = headRow(rows(r as QueueRowView[]));
      expect(cells(row)).toHaveLength(4);
      expect(row).toMatch(/data-col="cost">[\s\S]*<\/td><\/tr>$/);
    }
  });

  // Spec 159 landed with every phase in its git history — analyze,
  // implement AND archive — because the archive step DID
  // run: it made its commit and then declined to move the folder. The
  // row therefore had nothing left to suggest and drew no button at
  // all, beside a badge reading "archive held back". The one thing on
  // that row that needed a press was the one it did not offer.
  test("a held-back archive is offered again, however the history reads", () => {
    const html = rows(
      [],
      [
        target("159-ci", {
          done: ["analyze", "implement", "archive"],
          archiveHeldBack: { reason: "the first real Actions run is unwatched" },
        }),
      ],
    );
    expect(labels(state(html))).toEqual(["Archive"]);
    const posted = [...state(html).matchAll(/<input type="hidden" name="steps" value="([^"]+)">/g)].map(
      (m) => m[1],
    );
    expect(posted).toEqual(["archive"]);
  });

  // ...and so is a spec whose archive left NO held-back note. Spec 161
  // reached exactly that state hours later: the note was cleared by
  // hand, the history still said archive had run, and the row went to
  // "done — nothing waiting on you" about a spec sitting unarchived in
  // the list. A row that exists is a spec that is not archived — the
  // note is a reason, never the evidence.
  test("a listed spec offers Archive even with no held-back note", () => {
    const html = rows(
      [],
      [target("161-cleared", { done: ["analyze", "implement", "archive"] })],
    );
    expect(labels(state(html))).toEqual(["Archive"]);
  });

  // Spec 191: the two halves of that same cell were worked out apart.
  // The button read the rule above; the badge asked `g.done` raw, found
  // every phase in it, and said "done — nothing waiting on you" beside
  // a button reading "Archive". One row, two answers. Both are read
  // here, off ONE render, so they cannot drift again without this
  // failing.
  test("the badge and the button name the same phase once archive has run and declined", () => {
    const html = rows(
      [],
      [target("191-agree", { done: ["analyze", "review-plan", "implement", "archive"] })],
    );
    expect(state(html)).toContain(">ready<");
    expect(labels(state(html))).toEqual(["Archive"]);
  });

  // Spec 161's own scenario, asked of the BADGE this time: the
  // held-back note cleared by hand while the history still lists
  // archive. Clearing the reason archiving did not happen does not
  // make it have happened.
  test("a cleared held-back note leaves the badge saying archive is ready", () => {
    const html = rows(
      [],
      [target("191-cleared", { done: ["analyze", "review-plan", "implement", "archive"] })],
    );
    expect(state(html)).toContain(">ready<");
    expect(labels(state(html))).toEqual(["Archive"]);
    expect(state(html)).not.toContain("nothing waiting on you");
  });

});

// --- spec 161: a row's one action is primary, whichever it is ----------------
//
// Spec 157 built Run as a bare `.btn` on the argument that a column of
// primary buttons says nothing about which row to look at. A row draws
// exactly ONE control now, so there is no column to differentiate and
// nothing for the colour to tell apart — it only has to say the action
// is here. Cancel came along for the same reason plus one more: in dark
// mode `--danger` (#E8836B) and `--accent` (#F0663F) sit close enough in
// hue that an outlined Cancel and a filled button beside it said nothing
// different to the eye (looked at live, 2026-08-21).
describe("spec 161: the row's one action is primary", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (list: QueueRowView[], targets: QueueTarget[]) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, projects: ["aide"] },
      Date.parse("2026-08-21T12:00:00Z"),
    );
  /** Every button on a ROW, as its class attribute. Read off the table
   *  alone since spec 221: the search field above it has a Search button
   *  of its own, and it is not a row's action — the rule under test is
   *  about the one control a row draws. */
  const classes = (html: string): string[] =>
    [...html.slice(html.indexOf("<tbody")).matchAll(/<button[^>]*class="([^"]*)"[^>]*>/g)].map(
      (m) => m[1] ?? "",
    );
  const lead = (extra: Partial<QueueRowView> = {}) =>
    row({ id: "j1", specFolder: "161-one-variant", steps: ["analyze"], state: "done", ...extra });

  test("the Run button is filled, not bare (criterion 5)", () => {
    const html = rows([], [target("161-one-variant")]);
    expect(classes(html)).toEqual(["btn primary"]);
  });

  test("Cancel is filled too — it is the busy row's one action (criterion 6)", () => {
    const html = rows(
      [lead({ steps: ["implement"], stepIndex: 0, state: "running" })],
      [target("161-one-variant", { done: ["analyze"] })],
    );
    expect(classes(html)).toEqual(["btn primary"]);
    expect(html).not.toContain("danger");
  });

  // Resolve was the third variant here until spec 171 retired it. A
  // conflicted row now draws the ordinary Run, and it is filled like
  // every other row's one action.
  test("a conflicted row's Run is filled like any other (criterion 7)", () => {
    const html = rows(
      [lead({ errorReason: "conflict", error: "cannot merge — conflict" })],
      [target("161-one-variant", { done: ["analyze"] })],
    );
    expect(html).not.toContain(">Resolve</button>");
    expect(classes(html)).toEqual(["btn primary"]);
  });
});

// --- spec 192: the phase line's controls share one cell ---------------------
//
// Spec 165 made the phase lines REAL COLUMNS — the name, the phase's
// AI, then the model with the phase's box beside it. They had been
// three flex children of one cell until then, each pinned to a fixed
// width by hand so every select started at the same x, and a table
// column does that bookkeeping for free.
//
// It charges for it too. A column reserves a width of its own and
// carries its own cell padding, so three columns in a row is three
// reserved widths and two lots of padding between the name and the
// box — far enough apart that the three read as three separate things
// rather than as one line's worth of choice. Narrowing the model
// column's reserved width twice on 2026-08-22 closed part of the gap
// and left the column boundary itself standing, which is the half that
// mattered.
//
// So the AI select, the model select and the phase's box share ONE
// cell now — the cell the model select and the box already shared —
// and the three captions share the caption row's. The name keeps a
// cell of its own, hard left, untouched. The column the merge vacates
// is the one the head row's own pips occupy, and it goes back to being
// empty on a phase line, exactly as it was before spec 165. Seven
// columns either way.
describe("spec 192: the phase line's controls share one cell", () => {
  const target = (specFolder = "192-one-cell"): QueueTarget => ({
    project: "aide",
    specFolder,
  });

  const BOTH = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "codex-fast", budgetUsd: 5, tool: "codex" as const },
  ];
  const ONE = [{ name: "sonnet", budgetUsd: 3 }];

  const rows = (
    list: QueueRowView[] = [],
    opts: Partial<QueuePageOptions> = {},
    targets: QueueTarget[] = [target()],
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        projects: ["aide"],
        modelChoices: BOTH,
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-21T12:00:00Z"),
    );

  /** Every cell of one row, in order — the content between one cell's
   *  opening tag and the next one's. */
  const cells = (tr: string): string[] =>
    tr
      .split(/<t[dh]\b[^>]*>/)
      .slice(1)
      .map((s) => s.replace(/<\/t[dh]>[\s\S]*$/, ""));
  /** One row's cell OPENING TAGS, in order: what a cell is, as opposed
   *  to what is in it. */
  const cellTags = (tr: string): string[] => [...tr.matchAll(/<t[dh]\b[^>]*>/g)].map((m) => m[0]);
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">[\\s\\S]*?</tr>`))?.[0] ?? "";
  const caption = (html: string) =>
    html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";
  const subRows = (html: string) => [
    ...html.matchAll(/<tr class="subrow[^"]*"[^>]*data-step="[^"]*">[\s\S]*?<\/tr>/g),
  ].map((m) => m[0]);

  // --- criterion 2: the name is what the eye lands on -----------------------

  test("the phase's name has its own cell, alone and hard left (criterion 2)", async () => {
    const html = rows();
    for (const step of ["create", "analyze", "implement", "archive"]) {
      const first = cells(subRow(html, step))[0] ?? "";
      // The name, and no CONTROL in front of it: no phase box, no
      // placeholder span holding a column's place, no select. The
      // mobile fold control (2026-08-24) is the one deliberate
      // exception — its checkbox and chevron are invisible outside the
      // phone media query, so on a desktop the cell still reads as the
      // name alone.
      expect([step, first.includes("data-phase")]).toEqual([step, false]);
      expect([step, first.includes("<select")]).toEqual([step, false]);
      expect([step, first.includes('class="foldphase"')]).toEqual([step, true]);
      // The name is the whole of the visible text — a future
      // `STEP_LABELS` entry would reach a reader as a different word,
      // so the cell is checked for shape and not for the step's own
      // word.
      expect([
        step,
        /<(a|span)[^>]*>[a-z-]+<\/(a|span)><\/label>$/.test(first),
      ]).toEqual([step, true]);
      // And it is still a cell of its own: the merge is behind it, not
      // around it.
      expect([step, cellTags(subRow(html, step))[0]]).toEqual([step, '<td class="phasecell">']);
    }
    // And the indent that used to hold the box's place goes with it.
    const { CSS } = await import("../../../../src/render/ui/css.ts");
    expect(CSS).not.toContain("table.list tr.subrow .phasecell { padding-left");
  });

  // --- criterion 1: three controls, one cell, no column between them --------

  test("the AI select, the model select and the box share one cell (criterion 1)", () => {
    const html = rows();
    for (const step of ["create", "analyze", "implement", "archive"]) {
      const line = subRow(html, step);
      // One cell, directly after the name's, and no separate AI column
      // anywhere on the page.
      expect([step, cellTags(line)[1]]).toEqual([step, '<td class="modelcell">']);
      const merged = cells(line)[1] ?? "";
      expect([step, merged.includes(`data-ai="model.${step}"`)]).toEqual([step, true]);
      expect([step, merged.includes(`<select name="model.${step}"`)]).toEqual([step, true]);
      expect([step, merged.includes(`data-phase="${step}"`)]).toEqual([step, true]);
      // In the order the choices are made in: the AI decides which
      // models there are, so it comes before the model it fills in.
      expect([step, merged.indexOf("data-ai=") < merged.indexOf(`<select name="model.${step}"`)]).toEqual([
        step,
        true,
      ]);
    }
    expect(html).not.toContain("toolcell");
    // Nothing spans anything. One control down five rows was what the
    // rowspan carried, and there is no such control left.
    expect([...html.matchAll(/rowspan="/g)]).toHaveLength(0);
    // The caption line carries the words, never a control.
    expect(caption(html)).not.toContain("<select");
  });

  test("a step outside the usual four shares its cell the same way (criterion 1)", () => {
    const html = rows([
      row({ id: "j1", specFolder: "192-one-cell", steps: ["manifest"], stepIndex: 0, state: "done" }),
    ]);
    expect(subRows(html)).toHaveLength(5);
    const line = subRow(html, "manifest");
    expect(cellTags(line)[1]).toBe('<td class="modelcell">');
    expect(cells(line)[1]).toContain('data-ai="model.manifest"');
    expect(cells(line)[1]).toContain('<select name="model.manifest"');
  });

  // --- criterion 3: the captions move with the controls they head -----------

  test("all three captions sit in the merged cell (criterion 3)", () => {
    const html = rows();
    const capCells = cells(caption(html));
    expect(capCells[0]).toContain(">Phase<");
    // Two tools configured, so the AI has a word (spec 179) — and it
    // stands in the same cell as the two it now sits beside, in the
    // order the controls under it are drawn.
    const merged = capCells[1] ?? "";
    expect(merged).toContain(">AI<");
    expect(merged).toContain(">Model<");
    expect(merged).toContain(">Select<");
    expect(merged.indexOf(">AI<") < merged.indexOf(">Model<")).toBe(true);
    expect(merged.indexOf(">Model<") < merged.indexOf(">Select<")).toBe(true);
    // `data-cap` is what pairs a caption with its control: the
    // stylesheet gives the two the same width, so "AI" stands over the
    // AI select instead of the three words running together at the
    // left edge of the cell (2026-08-22).
    expect(merged).toContain('data-cap="ai"');
    expect(merged).toContain('data-cap="model"');
    expect(merged).toContain('data-cap="box"');
    expect(caption(html)).toMatch(
      /<td class="modelcell"><span class="row"><span class="muted small" data-cap="ai" data-ai-cap>AI<\/span>/,
    );
  });

  // --- criterion 4: one configured tool draws no AI at all ------------------

  test("one configured tool leaves the merged cell to the model and the box (criterion 4)", () => {
    const html = rows([], { modelChoices: ONE });
    // One AI is nothing to choose between, so neither the picker nor
    // its caption is drawn — and no empty cell is left standing where
    // the AI column used to be.
    expect(html).not.toContain("data-ai");
    expect(html).not.toContain("toolcell");
    expect(cells(caption(html))[1]).not.toContain(">AI<");
    for (const step of ["create", "analyze", "implement", "archive"]) {
      const line = subRow(html, step);
      expect([step, cellTags(line)[1]]).toEqual([step, '<td class="modelcell">']);
      const merged = cells(line)[1] ?? "";
      expect([step, merged.includes(`<select name="model.${step}"`)]).toEqual([step, true]);
      expect([step, merged.includes(`data-phase="${step}"`)]).toEqual([step, true]);
      expect([step, merged.includes("<select data-ai")]).toEqual([step, false]);
    }
  });

  // --- criterion 6: the model select keeps its cap, wherever it sits --------

  test("the model select's width is capped by what it IS, not where it sits (criterion 6)", async () => {
    const { CSS } = await import("../../../../src/render/ui/css.ts");
    // The floor and the cap the caption line and the boxes are lined
    // up by, unchanged in value from before the merge.
    expect(CSS).toContain(
      'table.list tr.subrow .modelcell > .row select[name^="model."] { min-width: 6.25rem; max-width: 100px; }',
    );
    // And selected by the select's own name, never by its position: an
    // AI select sits in front of it on a two-tool line, so a
    // `:first-child` rule would cap that one instead and let the model
    // select regrow to its widest option — the exact crowding this
    // spec removes.
    expect(CSS).not.toMatch(/\.modelcell > \.row > :first-child \{[^}]*min-width: 6\.25rem/);
    // The two-tool line really does put something else first, which is
    // what makes the sentence above more than a style preference.
    const both = cells(subRow(rows(), "analyze"))[1] ?? "";
    expect(both.indexOf("<select")).toBe(both.indexOf("<select data-ai"));
    // And the one-tool line puts the model select first, so the cap
    // has to hold in both arrangements.
    const one = cells(subRow(rows([], { modelChoices: ONE }), "analyze"))[1] ?? "";
    expect(one.indexOf("<select")).toBe(one.indexOf('<select name="model.analyze"'));
  });

  // --- criterion 9: seven columns, on every line -----------------------------

  test("the merge leaves five columns, and the caption matches them", () => {
    const html = rows();
    // Five since the blank trailing column went (2026-08-23); six
    // before that, when the pips moved in beside the spec's name and
    // the Progress column went with them. The caption line and every
    // phase line write the same number, or the table stops lining up
    // with its own head row.
    expect(cells(caption(html))).toHaveLength(5);
    for (const step of ["create", "analyze", "implement", "archive"]) {
      expect([step, cells(subRow(html, step)).length]).toEqual([step, 5]);
      // The third cell is the phase's own state now, not the empty one
      // the Progress column left behind.
      expect([step, cells(subRow(html, step))[2]]).toEqual([
        step,
        '<span class="muted small">not run yet</span>',
      ]);
    }
    expect([...html.matchAll(/rowspan="/g)]).toHaveLength(0);
  });

  // --- criterion 8: the script still finds the control ---------------------

  // The control posts nothing and finds the select it writes through
  // the `form` id and `data-ai` together (`applyAiPick`,
  // `queue-client.ts`). Neither depends on which `<td>` it sits in —
  // but both are markup this file writes, and moving the control into
  // the cell beside it is exactly the edit that could drop one without
  // a type error to say so.
  test("each line's control names its own form and its own model (criterion 8)", () => {
    const html = rows();
    const formId = html.match(/<form id="([^"]+)"/)![1];
    for (const step of ["create", "analyze", "implement", "archive"]) {
      const control = subRow(html, step).match(/<select[^>]*data-ai[^>]*>/)![0];
      // It posts nothing: the five `model.<step>` fields are still the
      // whole of what a press sends.
      expect([step, control.includes("name=")]).toEqual([step, false]);
      expect([step, control.includes(`form="${formId}"`)]).toEqual([step, true]);
      expect([step, control.includes(`data-ai="model.${step}"`)]).toEqual([step, true]);
    }
  });

  // --- criterion 5: a folded phase line at phone width ----------------------

  test("at phone width the AI/model pair folds behind the phase's chevron (criterion 5)", async () => {
    const { CSS } = await import("../../../../src/render/ui/css.ts");
    const narrow = CSS.slice(CSS.indexOf("@media (max-width: 40rem) {"));
    // Since the mobile-spec-row handoff (2026-08-24) a phase line is a
    // flex row at this width — identical open or shut — with the cells
    // dissolved (display:contents), and the AI/model pair hidden until
    // the phase's own fold checkbox shows it.
    expect(narrow).toMatch(/table\.list tr\.subrow \{ display: flex;/);
    expect(narrow.replace(/\s+/g, " ")).toContain(
      "table.list tr.subrow .modelcell, table.list tr.subrow .modelcell > .row " +
        "{ display: contents; }",
    );
    expect(narrow).toContain("table.list tr.subrow .aimodel { display: none; }");
    // And the widths the two selects reserve on a desktop are given
    // back — min AND max, or the 50/50 split never happens.
    expect(narrow).toContain(
      'table.list tr.subrow .modelcell > .row select[name^="model."] { min-width: 0; max-width: none; }',
    );
    // The pinned flex bases the three-in-one cell needed before spec
    // 165 stay gone: the widths are not pinned by hand this time.
    expect(CSS).not.toContain(".phasecell > .row");
    expect(CSS).not.toMatch(/\.modelcell[^{]*\{[^}]*flex: 0 0/);
  });
});

// --- spec 169: one picker per phase, AI and model together -------------------
//
// The row offered ONE AI for the whole spec and a model per phase, which
// read as though the tool were a decision made once. It never was: the
// runner reads `job.model[step]` for every step independently and
// derives both `--model` and `--tool` from that one entry, so a row can
// run analyze on Claude Code and implement on Codex today.
//
// The AI select posted nothing. All it did was hide the other tool's
// models from the five phase selects — which is precisely what stopped
// anyone discovering that a row can mix them. It goes, and the models
// are grouped by tool in the selects themselves.
//
// What took its slot — a "set all" control for the whole group — is
// gone again in spec 179, and what is left here is the half of spec
// 169 that outlived it: every phase select offers every model, grouped
// by tool, hiding nothing, with the fallbacks that decide which one is
// pre-filled.
describe("spec 169: one picker per phase", () => {
  const target = (specFolder = "169-one-picker"): QueueTarget => ({ project: "aide", specFolder });

  const BOTH = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "fable", budgetUsd: 12 },
    { name: "gpt-fast", budgetUsd: 5, tool: "codex" as const },
  ];
  /** Codex FIRST, so a fallback that took `modelChoices`'s head can be
   *  told from one that took the row's old resting tool. */
  const CODEX_FIRST = [
    { name: "gpt-fast", budgetUsd: 5, tool: "codex" as const },
    { name: "sonnet", budgetUsd: 3 },
  ];
  const ONE_TOOL = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "fable", budgetUsd: 12 },
  ];

  const rows = (
    list: QueueRowView[] = [],
    opts: Partial<QueuePageOptions> = {},
    targets: QueueTarget[] = [target()],
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        modelChoices: BOTH,
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-21T12:00:00Z"),
    );

  const STEPS = ["create", "analyze", "implement", "archive"];
  const phaseSelect = (html: string, step: string) =>
    html.match(new RegExp(`<select name="model\\.${step}"[\\s\\S]*?</select>`))?.[0] ?? "";
  const caption = (html: string) =>
    html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";

  // --- criterion 1 -----------------------------------------------------------

  test("every phase select offers every model, grouped by tool", () => {
    const html = rows();
    for (const step of STEPS) {
      const select = phaseSelect(html, step);
      expect([step, select !== ""]).toEqual([step, true]);
      expect([step, select.includes('<optgroup label="Claude Code">')]).toEqual([step, true]);
      expect([step, select.includes('<optgroup label="Codex">')]).toEqual([step, true]);
      // Every model, and none of them hidden: hiding half the list is
      // what stopped a reader discovering the row can mix tools.
      for (const m of BOTH) {
        expect([step, m.name, select.includes(`value="${m.name}"`)]).toEqual([step, m.name, true]);
      }
      expect([step, select.includes("hidden")]).toEqual([step, false]);
      // `data-tool` came back in spec 179 — read to say which AI a
      // model belongs to, never to hide one. The assertion that
      // nothing is hidden, right above, is what keeps the two apart.
      expect([step, /<option value="gpt-fast" data-tool="codex"/.test(select)]).toEqual([step, true]);
      expect([step, /<option value="sonnet" data-tool="claude"/.test(select)]).toEqual([step, true]);
      // The option's text is the model's name and nothing else — no
      // "(codex)" suffix (spec 167); the group above it says the tool
      // while the list is open, the name itself while it is closed.
      expect([step, select.includes("(codex)")]).toEqual([step, false]);
      expect([step, /<option value="gpt-fast"[^>]*>gpt-fast<\/option>/.test(select)]).toEqual([step, true]);
    }
    // The grouping is in the configured tool order — Claude Code, then
    // Codex — not whichever tool `modelChoices` happens to lead with.
    const first = phaseSelect(rows([], { modelChoices: CODEX_FIRST }), "analyze");
    expect(first.indexOf('label="Claude Code"')).toBeLessThan(first.indexOf('label="Codex"'));
  });

  test("a tool with no model configured draws no group of its own", () => {
    const select = phaseSelect(rows([], { modelChoices: ONE_TOOL }), "analyze");
    expect(select).toContain('<optgroup label="Claude Code">');
    expect(select).not.toContain("Codex");
  });

  // --- criterion 2 -----------------------------------------------------------

  test("no row-wide AI filter is drawn anywhere any more", () => {
    const html = rows();
    expect(html).not.toContain("data-tool-picker");
    // Nor the word the filter's own label carried: the AI is said in
    // the caption and in the option groups now, not in a control of
    // its own.
    expect(html).not.toMatch(/<label[^>]*>AI <select/);
  });

  // --- criterion 5's server half: what a phase has already run on -----------

  // `used` is what pre-fills a select with the model its phase really
  // ran on, and `data-ran="1"` is that fact said to the browser. It was
  // "set all"'s scope until spec 179 removed the control; it stays
  // because the server saying which phases have history, rather than
  // the browser re-deriving it, is the part worth keeping.
  test("a phase that has run says so on its select, and one that has not does not", () => {
    const html = rows([
      row({ id: "j1", specFolder: "169-one-picker", steps: ["analyze"], stepIndex: 0, state: "done", model: "fable" }),
    ]);
    expect(phaseSelect(html, "analyze").match(/<select[^>]*>/)![0]).toContain('data-ran="1"');
    for (const step of ["implement", "archive"]) {
      expect([step, phaseSelect(html, step).match(/<select[^>]*>/)![0].includes("data-ran")]).toEqual([step, false]);
    }
  });

  // --- criterion 7: the no-JS floor -----------------------------------------

  // Filling a model in from an AI is a script's job, and every control
  // on this page works without one. Without a script the AI select
  // must simply not be there: it writes the model select and does
  // nothing else, so one that looks pressable and silently does
  // nothing would be worse than the removed AI filter's inert
  // degradation ever was. Its caption goes with it — a column headed
  // "AI" with nothing under it reads as broken.
  test("with no script the AI selects are hidden, and the phase selects are not", () => {
    const html = rows();
    expect(html).toContain(
      "<noscript><style>[data-ai],[data-ai-cap]{display:none}</style></noscript>",
    );
    // The five selects underneath stay exactly as usable as they are
    // with a script: every model, in every one of them, unfiltered.
    for (const step of STEPS) {
      const select = phaseSelect(html, step);
      for (const m of BOTH) {
        expect([step, m.name, select.includes(`value="${m.name}"`)]).toEqual([step, m.name, true]);
      }
      expect([step, select.includes("hidden")]).toEqual([step, false]);
    }
  });

  // --- criterion 8 -----------------------------------------------------------

  // The merged "AI - Model" word spoke for a column the AI did not
  // have. Spec 179 gives it one, so the two are two words over two
  // columns and the model's is the single word it always names.
  test("the caption gives the AI a word of its own when there are two to tell apart", () => {
    const cap = caption(rows());
    expect(cap).toContain(">AI<");
    expect(cap).toContain(">Model<");
    expect(cap).not.toContain("AI - Model");
  });

  test("one tool is nothing to tell apart, so only the model is named", () => {
    const cap = caption(rows([], { modelChoices: ONE_TOOL }));
    expect(cap).toContain(">Model<");
    expect(cap).not.toContain(">AI<");
    expect(cap).not.toContain("AI - Model");
  });

  // --- criterion 9 -----------------------------------------------------------

  // The fallback for an unconfigured, never-run phase was biased toward
  // the row's "resting tool" (spec 141, spec 164). There is no resting
  // tool any more, so it is the first entry the configuration lists —
  // whatever tool that entry starts.
  test("an unconfigured, never-run phase falls back to the first configured model", () => {
    const html = rows([], { modelChoices: CODEX_FIRST });
    for (const step of STEPS) {
      const select = phaseSelect(html, step);
      expect([step, /<option value="gpt-fast"[^>]*selected/.test(select)]).toEqual([step, true]);
      expect([step, /<option value="sonnet"[^>]*selected/.test(select)]).toEqual([step, false]);
    }
  });

  // And nothing another phase ran on moves it: the row has no one tool
  // to rest on any more, so a Codex history on implement leaves the
  // phases with no history of their own exactly where they were.
  test("what one phase ran on does not decide another phase's fallback", () => {
    const html = rows([
      row({
        id: "j1", specFolder: "169-one-picker", steps: ["implement"],
        stepIndex: 0, state: "done", model: "gpt-fast",
      }),
    ]);
    expect(phaseSelect(html, "implement")).toMatch(/<option value="gpt-fast"[^>]*selected/);
    // `sonnet` leads BOTH, and leads it still.
    expect(phaseSelect(html, "analyze")).toMatch(/<option value="sonnet"[^>]*selected/);
  });

  // A configured default outranks the fallback exactly as it always did.
  test("a configured default still wins over the first entry", () => {
    const select = phaseSelect(rows([], { defaultModels: { default: "gpt-fast" } }), "analyze");
    expect(select).toMatch(/<option value="gpt-fast"[^>]*selected/);
  });

  // --- the lock a busy row puts on every control on it (spec 105, 151) ------

  test("a busy row locks its AI selects for the same reason as its models", () => {
    const html = rows([
      row({ id: "j1", specFolder: "169-one-picker", steps: ["implement"], stepIndex: 0, state: "running" }),
    ]);
    const control = html.match(/<select[^>]*data-ai[^>]*>/)![0];
    expect(control).toContain("disabled");
    expect(control).toContain('title="implement is running"');
  });

  test("a settled row's AI selects are live again", () => {
    const html = rows([
      row({ id: "j1", specFolder: "169-one-picker", steps: ["implement"], stepIndex: 0, state: "done" }),
    ]);
    expect(html.match(/<select[^>]*data-ai[^>]*>/)![0]).not.toContain("disabled");
  });
});

// --- spec 179: an AI and a model on every phase line -------------------------
//
// The row's one "set all" control is gone, and every phase line carries
// an AI select of its own beside its model select instead. Choosing an
// AI for a phase fills in the model for that same phase, and nothing
// else on the row moves.
//
// The AI select posts NOTHING and states nothing the job does not
// already hold: what a phase runs on stays one value on the job — the
// `model.<step>` field — and the tool is derived from it. So the
// select is READ on change, to fill the model in, and WRITTEN on
// redraw, to reflect it. Never the reverse, and never a second field.
//
// Which model an AI stands for is answered HERE, where the
// configuration is, and carried into the markup on each option's
// `data-default`: the step's configured default when that default
// belongs to the tool, else the first entry `modelChoices` lists for
// it. The browser copies a value; it never chooses one.
describe("spec 179: an AI and a model on every phase line", () => {
  const target = (specFolder = "179-ai-per-phase"): QueueTarget => ({ project: "aide", specFolder });

  const BOTH = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "fable", budgetUsd: 12 },
    { name: "gpt-fast", budgetUsd: 5, tool: "codex" as const },
  ];
  /** Codex FIRST, so a fallback that took `modelChoices`'s head can be
   *  told from one that took a literal "claude". */
  const CODEX_FIRST = [
    { name: "gpt-fast", budgetUsd: 5, tool: "codex" as const },
    { name: "sonnet", budgetUsd: 3 },
  ];
  const ONE_TOOL = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "fable", budgetUsd: 12 },
  ];

  const rows = (
    list: QueueRowView[] = [],
    opts: Partial<QueuePageOptions> = {},
    targets: QueueTarget[] = [target()],
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        modelChoices: BOTH,
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-21T12:00:00Z"),
    );

  const STEPS = ["create", "analyze", "implement", "archive"];
  const aiSelect = (html: string, step: string) =>
    html.match(new RegExp(`<select[^>]*data-ai="model\\.${step}"[\\s\\S]*?</select>`))?.[0] ?? "";
  const phaseSelect = (html: string, step: string) =>
    html.match(new RegExp(`<select name="model\\.${step}"[\\s\\S]*?</select>`))?.[0] ?? "";
  const caption = (html: string) =>
    html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";

  // --- criterion 1: one AI per phase, beside that phase's model ------------

  test("every phase line has an AI select, and it names its own model select", () => {
    const html = rows();
    for (const step of STEPS) {
      const select = aiSelect(html, step);
      expect([step, select !== ""]).toEqual([step, true]);
      // It sits BEFORE the model select it writes, on the same line.
      const line = html.match(new RegExp(`<tr class="subrow"[^>]*data-step="${step}">[\\s\\S]*?</tr>`))![0];
      expect([step, line.indexOf("data-ai=") < line.indexOf(`name="model.${step}"`)]).toEqual([step, true]);
      // One option per configured tool, in the page's own order —
      // Claude Code first, whichever tool `modelChoices` happens to
      // lead with — and the tool's reader-facing name, not the
      // config's short word.
      expect([step, [...select.matchAll(/<option /g)].length]).toEqual([step, 2]);
      expect([step, select.indexOf(">Claude Code<") < select.indexOf(">Codex<")]).toEqual([step, true]);
      expect([step, select.includes('value="claude"')]).toEqual([step, true]);
      expect([step, select.includes('value="codex"')]).toEqual([step, true]);
    }
    const first = aiSelect(rows([], { modelChoices: CODEX_FIRST }), "analyze");
    expect(first.indexOf(">Claude Code<")).toBeLessThan(first.indexOf(">Codex<"));
  });

  test("a tool with no model configured is not offered as an AI", () => {
    // One tool is nothing to choose between, so the control is not
    // drawn at all — the count that decides it is TOOLS, not models.
    const html = rows([], { modelChoices: ONE_TOOL });
    for (const step of STEPS) expect([step, aiSelect(html, step)]).toEqual([step, ""]);
    expect(html).not.toContain("data-ai");
    // And the model selects underneath are untouched by any of it.
    expect(html).toContain('<select name="model.analyze"');
  });

  test("no model configured at all draws no AI select either", () => {
    expect(rows([], { modelChoices: undefined })).not.toContain("data-ai");
  });

  // --- criterion 2: the model an AI fills in is worked out here ------------

  test("each option carries the model its tool fills in", () => {
    const select = aiSelect(rows(), "analyze");
    // The first entry `modelChoices` lists for that tool, in
    // configuration order — `fable` is a Claude model too and does not
    // lead.
    expect(select).toMatch(/<option value="claude" data-default="sonnet"/);
    expect(select).toMatch(/<option value="codex" data-default="gpt-fast"/);
  });

  test("a step's configured default is what its own tool fills in", () => {
    const html = rows([], { defaultModels: { analyze: "fable" } });
    // Configuration named a model for this step, and it is a Claude
    // one — so picking Claude Code gives it back rather than the
    // tool's first entry.
    expect(aiSelect(html, "analyze")).toMatch(/<option value="claude" data-default="fable"/);
    // The other tool has no configured opinion, so it falls through.
    expect(aiSelect(html, "analyze")).toMatch(/<option value="codex" data-default="gpt-fast"/);
    // And it is the STEP's default, not the row's: implement was not
    // named, so it keeps the tool's first entry.
    expect(aiSelect(html, "implement")).toMatch(/<option value="claude" data-default="sonnet"/);
  });

  test("a configured default belonging to the other tool is left to that tool", () => {
    const html = rows([], { defaultModels: { default: "gpt-fast" } });
    const select = aiSelect(html, "analyze");
    expect(select).toMatch(/<option value="codex" data-default="gpt-fast"/);
    expect(select).toMatch(/<option value="claude" data-default="sonnet"/);
  });

  // --- criterion 3's server half: the AI shown is the model's own ----------

  test("the AI shown is the tool of the model the phase is actually on", () => {
    const html = rows();
    // Nothing configured and nothing run: the model select falls back
    // to the first entry, and the AI select says whose it is.
    for (const step of STEPS) {
      expect([step, /<option value="claude"[^>]*selected/.test(aiSelect(html, step))]).toEqual([step, true]);
      expect([step, /<option value="codex"[^>]*selected/.test(aiSelect(html, step))]).toEqual([step, false]);
    }
    // Move the model, and the AI moves with it — the same fallback
    // decides both, so the two cannot disagree.
    const codexFirst = rows([], { modelChoices: CODEX_FIRST });
    expect(phaseSelect(codexFirst, "analyze")).toMatch(/<option value="gpt-fast"[^>]*selected/);
    expect(aiSelect(codexFirst, "analyze")).toMatch(/<option value="codex"[^>]*selected/);
  });

  test("a phase that ran on the other tool says so, and its neighbours do not", () => {
    const html = rows([
      row({
        id: "j1", specFolder: "179-ai-per-phase", steps: ["implement"],
        stepIndex: 0, state: "done", model: "gpt-fast",
      }),
    ]);
    expect(aiSelect(html, "implement")).toMatch(/<option value="codex"[^>]*selected/);
    expect(aiSelect(html, "analyze")).toMatch(/<option value="claude"[^>]*selected/);
  });

  // --- criterion 6: the control it replaces is gone ------------------------

  test("no set-all control exists anywhere on the page", () => {
    const html = rows();
    expect(html).not.toContain("data-set-all");
    expect(html).not.toContain("Set all");
    // Nor the caption cell it used to leave empty for itself.
    expect(caption(html)).not.toContain("<select");
  });

  // --- criterion 8: nothing new is posted ---------------------------------

  test("the AI select posts nothing at all", () => {
    const html = rows();
    for (const step of STEPS) {
      const tag = aiSelect(html, step).match(/<select[^>]*>/)![0];
      expect([step, tag.includes("name=")]).toEqual([step, false]);
    }
    // The whole page offers exactly the five model fields it always
    // did — one per phase, and nothing beside them.
    expect([...html.matchAll(/<select name="/g)]).toHaveLength(STEPS.length);
  });
});

// Spec 176: four things the row still said wrong. Three of them are
// about what a cell SAYS; this block holds the two that a rendered
// string can be asked about directly — the chip's border, and where a
// phase line's aside note goes.
describe("spec 176: the phase chip frames nothing", () => {
  test("a phase line's label-less chip draws no border (criterion 1)", async () => {
    const { CSS } = await import("../../../../src/render/ui/css.ts");
    expect(CSS).toContain(".phase[data-phase] { border-color: transparent; }");
  });

  // The second half of the criterion, and the reason the selector names
  // `data-phase` rather than `.phase`: a chip written with a label of
  // its own — the "Also touches" repo chips (`data-project`) and the
  // new-spec form's "Depends on" (`data-depends`) — frames something,
  // and keeps its frame.
  test("the transparent border reaches no chip that has a label (criterion 1)", async () => {
    const { CSS } = await import("../../../../src/render/ui/css.ts");
    expect(CSS.match(/\n\.phase \{[\s\S]*?\}/)![0]).toContain("border: 1px solid var(--line)");
    expect(CSS.match(/^[^\n]*border-color: transparent[^\n]*$/gm)).toEqual([
      ".phase[data-phase] { border-color: transparent; }",
    ]);
  });
});

// --- spec 195: a phase line shows its mark and nothing else -------------------
//
// A qualifier is a sentence, and spec 108 drew it in a `<div>` under the
// phase's badge. A `<div>` is a line of its own, so a phase with
// something to say was taller than the phase above it — and everything
// below the row moved the moment a run started, stopped, or a status
// file fell out of step with the git history. Spec 176 already moved the
// stale mark and the tries count BESIDE the badge for exactly this
// reason; the qualifier is the occupant it did not touch.
//
// The sentence is not lost: it goes into the panel spec 143 built for
// "a sentence too long for a cell", named for the phase it is about.
describe("spec 195: a phase line shows its mark and nothing else", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [],
    extra: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        filter: { open: openKeys(list, targets) },
        ...extra,
      },
      Date.parse("2026-08-22T12:00:00Z"),
    );
  const panel = (html: string) => html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "";
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  const BUILT = ["analyze", "implement"];

  // Criterion 4: the ordinary case, and the one that must stay silent.
  // A phase whose file and history agree has nothing to say anywhere —
  // a panel that repeats what a badge already shows is the same clutter
  // in a new place.
  test("a phase whose file and history agree says nothing, on the line or in the panel", () => {
    const html = rows([], [target("195-agreeing", { done: ["analyze"] })]);
    expect(subRow(html, "analyze")).toContain("b-done");
    expect(subRow(html, "analyze")).not.toContain("disagree");
    expect(panel(html)).toBe("");
  });

  // Criterion 5: two phases disagreeing at once is the case
  // 1-description.md flags ("three of these can fire at once"). The
  // panel has one slot, so it states the EARLIEST phase in workflow
  // order and names it — never an arbitrary pick, and never a
  // concatenation that grows without bound.
  test("two disagreeing phases collapse to the earlier one, named", () => {
    const html = rows(
      [
        row({ id: "reanalyze", specFolder: "195-both", steps: ["analyze"], state: "cancelled" }),
        row({ id: "impl", specFolder: "195-both", steps: ["implement"], state: "done" }),
      ],
      [target("195-both", { done: ["analyze"] })],
    );
    expect(panel(html)).toContain("analyze: last re-run cancelled");
    expect(panel(html)).not.toContain("implement:");
    expect(subRow(html, "analyze")).not.toContain("last re-run cancelled");
    expect(subRow(html, "implement")).not.toContain("disagree");
  });

  // Criterion 6: the rule itself, rather than one string at a time. No
  // phase line, in any state `wordPhase()` can produce, carries a
  // block-level element — which is what made one line taller than
  // another.
  test("no phase line carries block-level free text, in any state", () => {
    const cases: { name: string; html: string; step: string }[] = [
      {
        name: "done, agreeing",
        html: rows([], [target("195-a", { done: ["analyze"] })]),
        step: "analyze",
      },
      {
        name: "done, with a re-run that disagrees",
        html: rows(
          [row({ id: "c", specFolder: "195-b", steps: ["analyze"], state: "cancelled" })],
          [target("195-b", { done: ["analyze"] })],
        ),
        step: "analyze",
      },
      {
        name: "held back",
        html: rows(
          [row({ id: "h", specFolder: "195-c", steps: ["archive"], state: "done" })],
          [target("195-c", { done: BUILT, archiveHeldBack: { reason: "the Slack webhook" } })],
        ),
        step: "archive",
      },
      {
        name: "held back, with a qualifier of its own",
        html: rows(
          [row({ id: "h2", specFolder: "195-d", steps: ["archive"], state: "failed" })],
          [target("195-d", { done: BUILT, archiveHeldBack: { reason: "the Slack webhook" } })],
        ),
        step: "archive",
      },
      {
        name: "stopped, with no attempt left to say so",
        html: rows([], [target("195-e", { done: ["analyze"], stopped: { implement: "timeout" } })]),
        step: "implement",
      },
      {
        name: "the files disagree and nothing has been attempted",
        html: rows([], [target("195-f", { done: ["analyze"], fileDisagrees: ["implement"] })]),
        step: "implement",
      },
      {
        name: "running",
        html: rows(
          [row({ id: "r", specFolder: "195-g", steps: ["analyze"], state: "running" })],
          [target("195-g")],
        ),
        step: "analyze",
      },
    ];
    for (const c of cases) {
      expect(subRow(c.html, c.step)).not.toBe("");
      expect(`${c.name}: ${subRow(c.html, c.step)}`).not.toContain('<div class="muted small">');
    }
  });

  // Criterion 7: the new producer is the LOWEST of the four. A refusal
  // answers a button the reader just pressed, and a job's own error says
  // why the row is not moving — both outrank a standing disagreement.
  test("a refusal outranks a phase's disagreement in the panel", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "195-refused", steps: ["implement"], state: "done" })],
      [target("195-refused", { done: ["analyze"] })],
      { errorSpec: "aide/195-refused", error: "a job is already queued for this spec" },
    );
    expect(panel(html)).toContain("a job is already queued for this spec");
    expect(panel(html)).not.toContain("the files disagree");
  });

  test("a job's own error outranks a phase's disagreement in the panel", () => {
    const html = rows(
      [
        row({
          id: "impl",
          specFolder: "195-errored",
          steps: ["implement"],
          state: "failed",
          error: "the specs tree is dirty: /Users/ragnar/develop/aide-specs",
        }),
      ],
      [target("195-errored", { done: ["analyze"], fileDisagrees: ["analyze"] })],
    );
    expect(panel(html)).toContain("the specs tree is dirty");
    expect(panel(html)).not.toContain("the files disagree");
  });
});

// --- spec 210: a running implement says which third it is in -----------------
//
// An implement runs for an hour and the row says only "running". Which
// of its three parts it is in — writing the failing tests, making them
// pass, or the suite afterwards — is the difference between nearly done
// and barely started. `aide-implement` already reports each boundary and
// `AideRunStore` already keeps it; nothing read it.
//
// Two readers, one field. The phase LINE says the word (`running
// (green)`); the spec head row's pip fills a third at a time. The pip's
// own width never changes — a pip that grew would move everything on the
// line beside it.
describe("spec 210: a running implement says which third it is in", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [],
    extra: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        filter: { open: openKeys(list, targets) },
        ...extra,
      },
      Date.parse("2026-08-23T12:00:00Z"),
    );
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  /** The spec head row's pip strip — where the fill lives. The phase
   *  lines below carry no pip of their own. */
  const pipStrip = (html: string, specFolder: string) =>
    html
      .match(new RegExp(`<tr class="spechead[^"]*"[^>]*data-folder="${specFolder}">[\\s\\S]*?</tr>`))?.[0]
      .match(/<div class="pips">[\s\S]*?<\/div>/)?.[0] ?? "";
  /** The one pip in that strip that is the running one. `data-third` on
   *  any other pip would be the mark answering the wrong question. */
  const nowPip = (html: string, specFolder: string) =>
    pipStrip(html, specFolder).match(/<span class="pip now"[^>]*>/)?.[0] ?? "";

  // Criterion 2. `green` means RED is behind it: one third of three, not
  // two. The natural-looking mapping is off by one and nothing in the
  // type system catches it, so the worked value is pinned here.
  test("a running implement in GREEN reads (green) and fills one third", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "210-green", steps: ["implement"], state: "running", tddPhase: "green" })],
      [target("210-green")],
    );
    expect(subRow(html, "implement")).toContain("running (green)");
    expect(nowPip(html, "210-green")).toContain('data-third="1"');
  });

  // Criterion 3.
  test("a running implement in REFACTOR reads (refactor) and fills two thirds", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "210-ref", steps: ["implement"], state: "running", tddPhase: "refactor" })],
      [target("210-ref")],
    );
    expect(subRow(html, "implement")).toContain("running (refactor)");
    expect(nowPip(html, "210-ref")).toContain('data-third="2"');
  });

  // Criterion 4: zero thirds complete renders identically to "no report
  // arrived". A pip that looked 1/3 done five seconds into RED would
  // actively misinform, which is worse than saying nothing.
  test("a running implement in RED reads (red) and fills nothing", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "210-red", steps: ["implement"], state: "running", tddPhase: "red" })],
      [target("210-red")],
    );
    expect(subRow(html, "implement")).toContain("running (red)");
    expect(nowPip(html, "210-red")).not.toContain("data-third");
  });

  // Criterion 6: the report never arrived. Nothing throws, and the row
  // reads exactly as it does today.
  test("a running implement nobody reported on reads plain running, unfilled", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "210-silent", steps: ["implement"], state: "running" })],
      [target("210-silent")],
    );
    expect(subRow(html, "implement")).toContain("running");
    expect(subRow(html, "implement")).not.toContain("running (");
    expect(nowPip(html, "210-silent")).not.toContain("data-third");
  });

  // Criterion 5: analyze has no phase reports and is out of scope, so
  // its rows arrive without a `tddPhase` and read as they always did.
  // WHICH steps are given one is `jobRow`'s rule and is asserted where
  // that rule lives, in queue-detail.test.ts — naming the step a second
  // time here would be a second copy of it, which is this repo's own
  // recurring cost.
  test("a running step that is not implement is untouched", () => {
    const html = rows(
      [row({ id: "an", specFolder: "210-analyze", steps: ["analyze"], state: "running" })],
      [target("210-analyze")],
    );
    expect(subRow(html, "analyze")).toContain("running");
    expect(subRow(html, "analyze")).not.toContain("running (");
    expect(pipStrip(html, "210-analyze")).not.toContain("data-third");
  });

  // A job WAITING to start is in no TDD phase at all. Its own trap:
  // `inFlight` — what the phase word branches on — is queued OR
  // running, so a leftover report would have read "queued (refactor)".
  test("a queued implement carrying a phase still reads plain queued", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "210-waiting", steps: ["implement"], state: "queued", tddPhase: "green" })],
      [target("210-waiting")],
    );
    expect(subRow(html, "implement")).toContain("queued");
    expect(subRow(html, "implement")).not.toContain("(green)");
    expect(pipStrip(html, "210-waiting")).not.toContain("data-third");
  });

  // Criterion 7: the phase is over. A stale entry from the session it
  // once used must not fill a pip for a run that has stopped, nor
  // qualify a word that is no longer "running".
  test("an implement that is NOT running ignores a leftover phase", () => {
    for (const state of ["queued", "done", "failed", "stopped", "cancelled", "interrupted"] as const) {
      const html = rows(
        [row({ id: "impl", specFolder: "210-over", steps: ["implement"], state, tddPhase: "refactor" })],
        [target("210-over")],
      );
      expect(subRow(html, "implement")).not.toContain("(refactor)");
      expect(pipStrip(html, "210-over")).not.toContain("data-third");
    }
  });
});

// The markup half on its own: `pips()` is shared by the list and the job
// page, and the mark is only ever about the pip that is running.
describe("spec 210: pips() marks the completed thirds", () => {
  test("a now pip with a third carries the attribute", async () => {
    const { pips } = await import("../../../../src/render/ui/components.ts");
    expect(pips([{ kind: "now", title: "implement", third: 1 }])).toContain('data-third="1"');
    expect(pips([{ kind: "now", title: "implement", third: 2 }])).toContain('data-third="2"');
  });

  test("a now pip without a third carries nothing, exactly as before", async () => {
    const { pips } = await import("../../../../src/render/ui/components.ts");
    expect(pips([{ kind: "now", title: "implement" }])).toBe(
      `<div class="pips"><span class="pip now" title="implement"></span></div>`,
    );
  });

  test("a past or todo pip never carries the mark, whatever it is handed", async () => {
    const { pips } = await import("../../../../src/render/ui/components.ts");
    expect(pips([{ kind: "past", title: "analyze", third: 2 }])).not.toContain("data-third");
    expect(pips([{ kind: "todo", title: "archive", third: 1 }])).not.toContain("data-third");
  });
});
