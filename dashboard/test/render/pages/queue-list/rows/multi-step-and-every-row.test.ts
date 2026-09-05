import { describe, expect, test } from "bun:test";
import {
  renderQueueRows,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../../src/render.ts";
import { row, openKeys } from "../../fixtures.ts";

// Split out of grouping.test.ts by theme.

// --- a job that ran several steps belongs on all of them ---------------------
//
// Measured 2026-08-17 on spec 90: one job ran `analyze` and then
// `implement`, finished, and appeared ONLY on the implement line —
// because a job was placed by `steps[stepIndex]`, which is a single
// step. The analyze line was left showing an older attempt that had
// failed on `unknown spec`, so a finished analysis read as failed.
describe("a multi-step job is shown on every step it ran", () => {
  const rows = (list: QueueRowView[], targets: QueueTarget[] = []) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) } },
      Date.parse("2026-08-17T12:00:00Z"),
    );
  // Since spec 108 a phase line says what the spec's own FILES say, and
  // the job's outcome qualifies it. This block is about WHICH job
  // speaks for a line, so the file side has to agree the analysis is
  // done — otherwise the line is answering a different question.
  const analysed: QueueTarget[] = [{ project: "aide", specFolder: "90-grouped", done: ["analyze"] }];
  /** This block's spec page — where its phase lines point since spec 237. */
  const GROUPED_HREF = "/specs/aide/90-grouped";
  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";

  const twoStep = (extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({
      id: "both",
      specFolder: "90-grouped",
      steps: ["analyze", "implement"],
      stepIndex: 1,
      state: "done",
      spentUsd: 18.68,
      startedAt: "2026-08-17T11:00:00Z",
      results: [
        { step: "analyze", ok: true, costUsd: 5.95 },
        { step: "implement", ok: true, costUsd: 12.73 },
      ],
      ...extra,
    });

  // Spec 237: two steps of ONE job used to share one link, because the
  // link was the job's page. They now open two different tabs of the
  // same spec page — which is the distinction the reader wanted from
  // two lines in the first place.
  test("its two steps open the two tabs they wrote", () => {
    const html = rows([twoStep()]);
    expect(subRow(html, "analyze")).toContain(`href="${GROUPED_HREF}?tab=solution"`);
    expect(subRow(html, "implement")).toContain(`href="${GROUPED_HREF}?tab=status"`);
    expect(html).not.toContain('href="/specs/both"');
  });

  test("an older failed attempt does not speak for a step that has since passed", () => {
    const html = rows([
      row({
        id: "old",
        specFolder: "90-grouped",
        steps: ["analyze"],
        stepIndex: 0,
        state: "failed",
        error: "unknown spec",
        startedAt: "2026-08-17T09:00:00Z",
      }),
      twoStep(),
    ], analysed);
    const analyze = subRow(html, "analyze");
    expect(analyze).toContain(`href="${GROUPED_HREF}?tab=solution"`);
    expect(analyze).toContain("b-done");
    expect(analyze).not.toContain("unknown spec");
    expect(analyze).toContain("2 attempts");
  });

  test("each step carries its own cost, so the two do not both show the total", () => {
    const html = rows([twoStep()]);
    expect(subRow(html, "analyze")).toContain("$5.95");
    expect(subRow(html, "implement")).toContain("$12.73");
    // The header still totals the JOB, which is what was spent on the spec.
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    expect(head).toContain("$18.68");
  });

  test("a finished step reads as done while the next one is still running", () => {
    const html = rows([
      twoStep({ state: "running", spentUsd: 5.95, results: [{ step: "analyze", ok: true, costUsd: 5.95 }] }),
    ], analysed);
    expect(subRow(html, "analyze")).toContain("b-done");
    expect(subRow(html, "implement")).toContain("b-running");
  });

  // Spec 143 moved the reason itself off the phase line and into the
  // row's panel: it is a sentence, and the State column is a cell sized
  // for a word. Which STEP failed is still said on the line — that half
  // is what this test has always been about — and the sentence is said
  // once, for the row.
  test("the step that failed is marked as such; the reason is said once, on the row", () => {
    const html = rows([
      twoStep({
        state: "failed",
        error: "cannot fast-forward main",
        spentUsd: 5.95,
        results: [
          { step: "analyze", ok: true, costUsd: 5.95 },
          { step: "implement", ok: false, costUsd: 0 },
        ],
      }),
    ], analysed);
    expect(subRow(html, "analyze")).toContain("b-done");
    expect(subRow(html, "analyze")).not.toContain("cannot fast-forward");
    expect(subRow(html, "implement")).toContain("b-refused");
    expect(subRow(html, "implement")).not.toContain("cannot fast-forward");
    expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
      "cannot fast-forward main",
    );
    expect([...html.matchAll(/cannot fast-forward main/g)]).toHaveLength(1);
  });

  test("a job with no per-step results still lands on the step it is on", () => {
    const html = rows([
      row({ id: "plain", specFolder: "90-grouped", steps: ["implement"], stepIndex: 0, state: "queued" }),
    ]);
    expect(subRow(html, "implement")).toContain(`href="${GROUPED_HREF}?tab=status"`);
    expect(subRow(html, "analyze")).toContain("not run yet");
  });
});
// --- spec 90: every spec is a row, and analyze starts from it ----------------

// The dropdown at the top and the list held the same things: one showed
// specs that had not started, the other specs that had. A spec crossed
// from one to the other the first time it ran, and nothing about that
// crossing was meaningful to the reader.
describe("every spec is a row (criteria 1-10)", () => {
  const job = (id: string, step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({ id, specFolder: "90-has-run", steps: [step], stepIndex: 0, state: "done", ...extra });

  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[],
    opts: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        // Open, because this block is about what a row HOLDS — the
        // phase lines and the form that runs them, which spec 103 put
        // behind the fold without changing either. The targets alone:
        // a job whose spec is no longer a target must not reach the
        // page through the fold state either.
        filter: { open: openKeys([], targets) },
        ...opts,
      },
      Date.parse("2026-08-17T12:00:00Z"),
    );

  const heads = (html: string) => html.match(/<tr class="[^"]*spechead[^"]*"[^>]*>/g) ?? [];
  // One header row and everything up to the next `<tr`, which is the
  // whole header line and nothing else.
  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";
  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  /** The line the run control opens onto, under the header (spec 109). */
  const runLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";

  test("a target with no jobs gets a header row and four phase lines (criterion 1)", () => {
    const html = rows([], [target("90-never-run")]);
    expect(heads(html)).toHaveLength(1);
    const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["create", "analyze", "implement", "archive"]);
    for (const phase of order) expect(subRow(html, phase!)).toContain("not run yet");
  });

  test("a never-run spec's own row runs analyze (criterion 2)", () => {
    // Spec 94 moved the form off the phase line and onto the spec's own
    // row; spec 109 moved it off the header cell and onto the line the
    // row opens to. Either way it is the SPEC's control, not a phase's.
    const html = rows([], [target("90-never-run")]);
    const line = runLine(html, "90-never-run");
    expect(line).toContain('method="post" action="/api/queue"');
    expect(line).toContain('name="project" value="aide"');
    expect(line).toContain('name="specFolder" value="90-never-run"');
    expect(line).toContain('name="steps" value="analyze"');
    expect(line).toContain(">Analyze</button>");
    // Nothing an idle row can act on is disabled. `create`'s box is,
    // always and by construction (2026-08-21), so the claim is made
    // about the three runnable phases rather than the whole row.
    for (const step of ["analyze", "implement", "archive"]) {
      expect(subRow(html, step)).not.toContain("disabled");
    }
    expect(line).not.toContain("<button[^>]*disabled");
    expect(subRow(html, "analyze")).not.toContain("<form");
  });

  test("a never-run spec reads what comes next and links to its SPEC (criterion 3)", () => {
    const html = rows([], [target("90-never-run")]);
    const line = head(html, "90-never-run");
    // Spec 176: "not started" and "ready for implement" describe the
    // same kind of situation — nothing running, and here is what could
    // — so the column says what comes next on both. Nothing has run
    // here, so the next phase is analyze.
    expect(line).toContain('class="badge b-ready"');
    expect(line).toContain(">ready<");
    expect(line).not.toContain("not started");
    // It used to link to nothing — "a link to nothing is worse than no
    // link". Spec 150 gave every spec somewhere to point, so what must
    // NOT be there is a JOB link: a spec that has never run has no job.
    expect(line).toContain('href="/specs/aide/90-never-run"');
    expect(line).toContain("90-never-run");
  });

  test("a spec that is both a target and has jobs gets one row (criterion 4)", () => {
    const html = rows([job("j1", "analyze")], [target("90-has-run")]);
    expect(heads(html)).toHaveLength(1);
    expect(html).toContain('href="/specs/aide/90-has-run?tab=solution"');
  });

  test("a job group whose spec is no longer a target is off the page (criterion 5)", () => {
    const html = rows([job("j1", "analyze")], [target("90-something-else")]);
    expect(html).not.toContain("90-has-run");
    expect(heads(html)).toHaveLength(1);
  });

  test("a project with no targets at all keeps every group it has (criterion 6)", () => {
    // An empty target list is "we do not know", never "everything is
    // archived": a specs root that is not checked out on this host looks
    // exactly the same from here.
    const html = rows([job("j1", "analyze")], [target("01-first", { project: "paceup" })]);
    expect(html).toContain("90-has-run");
    expect(html).toContain("01-first");
  });

  // The block sits at the TOP now, not the bottom: a never-run spec git
  // has not dated shows "–" in Created, and that is a folder made
  // moments ago rather than an old one. Sorting it as the oldest sent
  // the newest thing on the list to the bottom of a newest-first list.
  // What criterion 7 asked for — that they stay a stable block, ordered
  // by folder — is unchanged.
  test("never-run specs form a stable block at the top", () => {
    const html = rows(
      [job("j1", "analyze", { startedAt: "2026-08-16T09:00:00Z" })],
      // Dated, so it is not itself one of the undated ones: the point
      // here is where the undated BLOCK sits relative to a spec that
      // has a date, and a fixture with no date on any of the three
      // would put all of them in the block.
      [target("90-has-run", { createdAt: "2026-08-16T09:00:00Z" }), target("88-never"), target("89-never")],
    );
    const order = [...html.matchAll(/<tr class="[^"]*spechead[^"]*"[^>]*data-folder="([^"]+)"/g)].map(
      (m) => m[1],
    );
    // The higher-numbered folder comes first within the block.
    expect(order).toEqual(["89-never", "88-never", "90-has-run"]);
  });

  test("two specs that have both RUN keep the order they have today (criterion 7)", () => {
    // A general folder tie-break would reverse this pair. It must reach
    // only groups where `activityAt` is 0 on both sides.
    const html = rows(
      [
        job("j1", "analyze", { specFolder: "aa-spec", startedAt: "2026-08-16T09:00:00Z" }),
        job("j2", "analyze", { specFolder: "bb-spec", startedAt: "2026-08-16T09:00:00Z" }),
      ],
      [],
      { filter: { sort: "started" } },
    );
    const order = [...html.matchAll(/<tr class="[^"]*spechead[^"]*"[^>]*data-folder="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(order).toEqual(["aa-spec", "bb-spec"]);
  });

  test("Active includes never-run specs without a separate chip (criterion 8)", () => {
    const list = [job("j1", "analyze", { state: "done" })];
    const targets = [target("90-has-run"), target("90-never-run")];
    const html = rows(list, targets);
    expect(html).toMatch(/>All \(2\)</);
    expect(html).not.toContain(">Not started");
    expect(html).toMatch(/>Running \(0\)</);
    expect(html).toMatch(/>Done \(1\)</);
    expect(html).toMatch(/>Problems \(0\)</);

    expect(html).toContain("90-never-run");
    expect(html).toContain("90-has-run");
  });

  test("a never-run spec costs a dash and has taken 0s (criterion 9)", () => {
    const line = head(rows([], [target("90-never-run")]), "90-never-run");
    expect(line).not.toContain("$0.00");
    expect(line).not.toContain("Invalid Date");
    expect(line).not.toContain("NaN");
    // Cost is unknown until something spends, so it stays a dash. Time
    // is not unknown: nothing has run, and that is `0s` — an empty cell
    // there asks the reader whether the row is broken.
    expect(line).toContain("0s");
    expect(line.match(/–/g)?.length).toBeGreaterThanOrEqual(1);
  });

  test("with neither jobs nor targets the page says there is no spec (criterion 10)", () => {
    const html = rows([], []);
    expect(html).toContain("No spec");
    expect(html).not.toContain("Pick a spec above");
  });
});
