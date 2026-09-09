import { describe, expect, test } from "bun:test";
import {
  renderQueueRows,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../../src/render.ts";
import { row, openKeys } from "../../fixtures.ts";

// --- spec 94: a spec's phases are ticked and run from its own row ------------
//
// Split out of row-status-and-controls.test.ts by theme: the phase
// box's own ticking/locking rules (specs 267, 160, 225). The rest of
// "a spec's row runs its own phases" — folding, the row summary, the
// top form, refusals — is in phase-row-rendering.test.ts.
//
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

  // Spec 124 left a done phase unticked, saying "done" only once, in
  // the State column. Spec 267 reverses that: the box now answers a
  // different question — has this phase run — so a done phase reads
  // ticked AND locked, in the same shape `create`'s own line always
  // has.
  test("done phases are ticked and locked; the next one stays pre-ticked (spec 267, criterion 1)", () => {
    const html = rows(
      [job("j1", "analyze"), job("j2", "implement")],
      [target("94-row-runs-it", { done: ["analyze", "implement"] })],
    );
    const line = runLine(html, "94-row-runs-it");
    expect(box(line, "analyze")).toContain("checked disabled");
    expect(box(line, "implement")).toContain("checked disabled");
    // Nothing is in flight, so the still-ahead box is not locked. (The
    // stack's own Approve, Cancel and Merge are disabled — there is no
    // job to approve and no branch to merge — which is spec 124's
    // point: they stand there either way.)
    expect(box(line, "archive")).toContain('value="archive" checked');
    expect(box(line, "archive")).not.toContain("disabled");
  });

  // A row that EXISTS is a spec that is not archived (2026-08-21), so
  // `archive` is never counted as done however the history reads —
  // which leaves it the one phase still tickable here. The two that
  // really did run are ticked and locked instead (spec 267).
  test("with every phase run, only archive stays tickable — the rest are ticked and locked", () => {
    const line = runLine(
      rows(
        [job("j1", "archive")],
        [target("94-row-runs-it", { done: ["analyze", "implement", "archive"] })],
      ),
      "94-row-runs-it",
    );
    for (const step of ["analyze", "implement"]) {
      expect(box(line, step)).toContain("checked disabled");
    }
    expect(box(line, "archive")).toContain("checked");
    expect(box(line, "archive")).not.toContain("disabled");
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
    // `analyze` is done, so its box reads ticked and locked (spec 267)
    // rather than pre-ticked; the two phases after it are pre-ticked
    // and tickable — every phase that has not run, not the next one
    // only.
    const line = runLine(rows([], [target("94-never-run", { done: ["analyze"] })]), "94-never-run");
    expect(box(line, "analyze")).toContain("checked disabled");
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

  // Spec 267: a finished phase reads ticked and locked, not tickable —
  // the box answers "has this phase run", and `g.done` already proves
  // it did. Re-running it is `/aide-reset`'s job, not this row's.
  test("a phase already done is ticked and locked, not offered for a rerun (spec 267)", () => {
    const line = runLine(
      rows([job("j1", "analyze")], [target("94-row-runs-it", { done: ["analyze"] })]),
      "94-row-runs-it",
    );
    expect(box(line, "analyze")).toContain(
      '<label class="phase checked" data-phase="analyze">' +
        '<input type="checkbox" value="analyze" checked disabled ' +
        'aria-label="analyze — already done, and not a step you can run"> ' +
        "<span></span></label>",
    );
    expect(box(line, "analyze")).not.toContain('name="steps"');
  });

  test("a finished implement is ticked and locked the same way, while analyze stays tickable (spec 267)", () => {
    const line = runLine(
      rows([job("j1", "implement")], [target("94-row-runs-it", { done: ["implement"] })]),
      "94-row-runs-it",
    );
    expect(box(line, "implement")).toContain("checked disabled");
    expect(box(line, "implement")).not.toContain('name="steps"');
    expect(box(line, "analyze")).toContain('name="steps" value="analyze"');
    expect(box(line, "analyze")).toContain("checked");
    expect(box(line, "analyze")).not.toContain("disabled");
  });

  // The held-back-archive exception: `archive` ran and committed but
  // declined to move the folder, so it stays in `g.done` on a row that
  // is still active — and this box must keep the ordinary tickable
  // treatment, not the new locked one (2-analysis.md, "The archive
  // exception").
  test("a held-back archive already in g.done stays tickable, not locked (spec 267, criterion 4)", () => {
    const line = runLine(
      rows(
        [job("j1", "archive")],
        [target("94-row-runs-it", { done: ["analyze", "implement", "archive"] })],
      ),
      "94-row-runs-it",
    );
    expect(box(line, "archive")).toContain('name="steps" value="archive"');
    expect(box(line, "archive")).toContain("checked");
    expect(box(line, "archive")).not.toContain("disabled");
  });

  // A phase already in `g.done` can still be genuinely re-running (e.g.
  // a `/aide-reset`-triggered redo, outside this row's own UI). The busy
  // path must keep rendering — checked, disabled, with the busy reason
  // — not the "already done" wording (spec 267, criterion 5).
  test("a busy rerun of an already-done phase keeps the busy wording, not 'already done' (spec 267, criterion 5)", () => {
    const line = runLine(
      rows(
        [job("j1", "analyze", { state: "running" })],
        [target("94-row-runs-it", { done: ["analyze"] })],
      ),
      "94-row-runs-it",
    );
    expect(box(line, "analyze")).toContain("disabled");
    expect(box(line, "analyze")).toContain('title="analyze is running"');
    expect(box(line, "analyze")).not.toContain("already done");
  });

  // Spec 286: a later phase retrying (e.g. archive, after a failed
  // landing) must not blank out the boxes of earlier phases the SAME run
  // already finished — the busy job's own `steps` only names what IT will
  // run, and `g.done` is still the truthful record of what already ran.
  test("a done phase keeps its checked box while a later phase in the same run retries (spec 286)", () => {
    const line = runLine(
      rows(
        [job("j1", "archive", { state: "running" })],
        [target("94-row-runs-it", { done: ["analyze", "implement"] })],
      ),
      "94-row-runs-it",
    );
    for (const step of ["analyze", "implement"]) {
      expect(box(line, step)).toContain("checked disabled");
      expect(box(line, step)).not.toContain('name="steps"');
    }
  });

  test("with only its own project there is nothing to add (criterion 5)", () => {
    const html = rows([], [target("94-never-run")], { projects: ["aide"] });
    expect(runLine(html, "94-never-run")).not.toBe("");
    expect(html).not.toContain('name="extraProjects"');
  });
});

// The Select column and the two selects beside it answer the same
// question — can this row still run this phase — and they used to
// disagree: a done phase, and `create` on every row, drew a ticked and
// disabled box next to an AI and a Model select the reader could still
// change. Nothing came of the change, which is what made it worth
// reporting: the picks are a record of what ran.
describe("a phase whose box is locked has its AI and model locked too", () => {
  const TOOLS: QueuePageOptions["modelChoices"] = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "gpt-5", budgetUsd: 3, tool: "codex" },
  ];
  const render = (done: string[]): string =>
    renderQueueRows(
      [],
      {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: "413-locked-pickers", done }],
        modelChoices: TOOLS,
        filter: { open: openKeys([], [{ project: "aide", specFolder: "413-locked-pickers" }]) },
      },
      Date.parse("2026-09-09T12:00:00Z"),
    );
  const line = (html: string, step: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${step}">.*?</tr>`))?.[0] ?? "";
  const select = (html: string, attr: string, step: string) =>
    html.match(new RegExp(`<select ${attr}="model\\.${step}"[^>]*>`))?.[0] ?? "";

  test("a phase this row has run offers neither pick", () => {
    const analyze = line(render(["analyze"]), "analyze");
    expect(analyze).toContain("checked disabled");
    expect(select(analyze, "name", "analyze")).toContain("disabled");
    expect(select(analyze, "data-ai", "analyze")).toContain("disabled");
  });

  test("create is drawn the same way, on a row that has run nothing", () => {
    const create = line(render([]), "create");
    expect(create).toContain("checked disabled");
    expect(select(create, "name", "create")).toContain("disabled");
    expect(select(create, "data-ai", "create")).toContain("disabled");
  });

  test("a phase still ahead keeps both", () => {
    const archive = line(render(["analyze"]), "archive");
    expect(archive).not.toContain("disabled");
    expect(select(archive, "name", "archive")).not.toContain("disabled");
    expect(select(archive, "data-ai", "archive")).not.toContain("disabled");
  });
});
