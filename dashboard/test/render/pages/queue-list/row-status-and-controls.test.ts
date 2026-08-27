import { describe, expect, test } from "bun:test";
import {
  renderQueuePage,
  renderQueueRows,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../src/render.ts";
import { ICON_LOCK } from "../../../../src/render/ui/components.ts";
import {
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
