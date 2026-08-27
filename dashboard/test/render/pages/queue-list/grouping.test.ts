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
import {
  NAV,
  detail,
  row,
  openKeys,
} from "../fixtures.ts";


// Criterion 12: the row a reader actually watches is the way in.
//
// Spec 150 changed WHERE in: the name opens the SPEC, not whichever job
// happened to run last — so every spec has somewhere to point, including
// one that has never run anything.
describe("the queue row links to the spec (criterion 12)", () => {
  const SPEC_HREF = "/specs/aide/81-queue-and-runner";

  test("the spec cell links to the spec page", () => {
    const html = renderQueueRows([row()], { runnerAvailable: true, targets: [] });
    // The project leads the name since 2026-08-21: a folder number is
    // only unique within its project, and the line under the name — where
    // the project used to sit — now carries what nothing else says.
    expect(html).toContain(
      `<a class="label" data-goto href="${SPEC_HREF}" title="aide:81-queue-and-runner">`+
        `<span class="muted">aide:</span>81-queue-and-runner</a>`,
    );
  });

  // "A spec that has never run has no job page to point at, so the name
  // is text: a link to nothing is worse than no link." That sentence is
  // what the spec page invalidates.
  test("a spec that has never run is a link too", () => {
    const html = renderQueueRows([], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
    });
    expect(html).toContain(`href="${SPEC_HREF}"`);
    expect(html).not.toContain('<span class="label" title="81-queue-and-runner">');
  });

  // Spec 237: a phase line no longer leaves the spec. It opens the tab
  // that shows what that phase MADE — analyze's is 3-solution.md — on
  // the spec page the reader is already looking at.
  test("the phase lines point at the tab their phase wrote", () => {
    const html = renderQueueRows([row({ steps: ["analyze"], state: "done" })], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      filter: { open: "aide/81-queue-and-runner" },
    });
    expect(html).toContain(`href="${SPEC_HREF}?tab=solution"`);
    expect(html).not.toContain('href="/specs/job-1234"');
  });

  // The name clamps to two lines with an ellipsis, and the marks carry
  // a lead-in (reworked 2026-08-26 from a one-line clamp that hid most
  // of a long folder name behind a click).
  test("the marks say what they are, and the stylesheet clamps the name", async () => {
    const html = renderQueueRows(
      [row({ branchUrls: [{ label: "aide", url: "https://example.test/compare" }] })],
      { runnerAvailable: true, targets: [] },
    );
    expect(html).toContain('<span class="branchlist"><span class="lbl">Repos:</span>');
    // Spec 161: "Affected" said nothing — a repo listed on a spec's row
    // is affected by it, which is why it is listed.
    expect(html).not.toContain("Affected repos");
    const { CSS } = await import("../../../../src/render/ui/css.ts");
    expect(CSS).toContain(".spec-name > .label { overflow: hidden;");
    expect(CSS).toContain("-webkit-line-clamp: 2;");
  });

  test("an existing branch link stays beside it, never replaced by it", () => {
    const html = renderQueueRows(
      [row({ branchUrls: [{ label: "aide", url: "https://example.test/compare" }] })],
      { runnerAvailable: true, targets: [] },
    );
    expect(html).toContain(
      '<a class="label" data-goto href="/specs/aide/81-queue-and-runner" title="aide:81-queue-and-runner">' +
        '<span class="muted">aide:</span>81-queue-and-runner</a>',
    );
    expect(html).toContain('href="https://example.test/compare"');
  });
});
// --- spec 04: a finished job does not say its work is unmerged ---------------

// Criteria 1-4: the branch link alone says where the work IS, never
// whether it landed. A reader who sees only the link reads a finished
// job as a delivered one.
//
// The repo list is about WHERE the work is. It carried a mark beside
// every unlanded branch — "waiting for archive", once per repo — until
// nobody could say who had asked for it: the State column says what the
// spec waits for, and a two-repo row said it three times. The rule that
// replaces four specs' worth of wording is a flat one, asserted below:
// links, and nothing else.
describe("the repo list says where the work is, and nothing more", () => {
  const BRANCH = "https://example.test/compare";
  // Spec 89: one entry per repo. A one-repo spec is a list of one,
  // through the same code a two-repo spec uses.
  const at = () => [{ label: "aide", url: BRANCH }];
  const queueRows = (extra: Partial<QueueRowView>) =>
    renderQueueRows([row(extra)], { runnerAvailable: true, targets: [] });
  /** The repo list and NOTHING after it: it sits in the name cell,
   *  which the State cell follows — so a slice to the end of the row
   *  would carry the very chip these tests prove it does not repeat. */
  const branchArea = (html: string): string => {
    const from = html.slice(html.indexOf('class="branchlist"'));
    return from.slice(0, from.indexOf("</td>"));
  };

  // The whole point: no badge, in any job state, landed or not.
  test.each(["running", "queued", "done", "failed", "stopped"] as const)(
    "a %s job's repo list carries no state of any kind",
    (state) => {
      const html = queueRows({ branchUrls: at(), state });
      expect(html).not.toContain("waiting for archive");
      expect(branchArea(html)).not.toContain('class="badge');
      // The link a reader actually uses is untouched.
      expect(html).toContain(`href="${BRANCH}"`);
    },
  );

  // The verb was never the problem — saying it a second and third time
  // was. It must go on being said ONCE, in the State column.
  test.each([
    ["create", "creating"],
    ["analyze", "analyzing"],
    ["implement", "implementing"],
    ["archive", "archiving"],
  ])("a %s job still says %s in the State column, and never in the repo list", (step, running) => {
    for (const state of ["running", "queued"] as const) {
      const html = queueRows({ branchUrls: at(), state, steps: [step], stepIndex: 0 });
      expect(html).toContain(state === "running" ? `>${running}<` : `>${running} queued<`);
      expect(branchArea(html)).not.toContain(running);
    }
  });

  // Spec 89: the two branches share a NAME and nothing else, so each
  // gets its own link. That survives; only the mark beside it went.
  test("two repos get two links", () => {
    const html = queueRows({
      state: "done",
      branchUrls: [
        { label: "aide", url: "https://example.test/aide" },
        { label: "aide-specs", url: "https://example.test/aide-specs" },
      ],
    });
    expect(html).toContain("https://example.test/aide-specs");
    expect(html).toContain("aide-specs");
    expect(html).not.toContain("waiting for archive");
  });

  // Spec 150 took the Work line off the job page; the row carries the
  // branch. Neither page may bring the mark back.
  test("the job page carries no branch and no mark (spec 150)", () => {
    for (const state of ["running", "done"] as const) {
      const html = renderJobDetailPage(
        detail({ branchUrls: at(), state }),
        "2026-08-17T10:00:00Z",
        NAV,
        { tab: "overview" },
      );
      expect(html).not.toContain(BRANCH);
      expect(html).not.toContain("waiting for archive");
    }
  });
});
// --- spec 95: where the branch can be TRIED ----------------------------------

// The compare link says where the work is; for a web app the link that
// matters more is "try it". A project whose host builds every branch has
// one address per branch, and until now a reader had to know the host's
// naming rule and paste it together by hand.
describe("the preview link beside the compare link (criteria 1-4)", () => {
  const PREVIEW = "https://aide-95-preview.example.pages.dev";
  const queueRows = (extra: Partial<QueueRowView>) =>
    renderQueueRows([row(extra)], { runnerAvailable: true, targets: [] });
  const jobPage = (extra: Partial<JobDetailView>) =>
    renderJobDetailPage(detail(extra), "2026-08-17T10:00:00Z", NAV, { tab: "overview" });
  const withPreview = [
    { label: "aide", url: "https://example.test/aide", previewUrl: PREVIEW },
  ];

  test("the row shows it next to the compare link, never instead of it (criterion 1)", () => {
    const html = queueRows({ branchUrls: withPreview, state: "done" });
    expect(html).toContain(`href="${PREVIEW}"`);
    expect(html).toContain('href="https://example.test/aide"');
    expect(html).toContain(">preview</a>");
  });

  // Spec 150 took the Work line off the job page; the row is where both
  // links live now.
  test("the job page shows neither link — the row carries both (spec 150)", () => {
    const html = jobPage({ branchUrls: withPreview, state: "done" });
    expect(html).not.toContain(PREVIEW);
    expect(html).not.toContain('href="https://example.test/aide"');
  });

  // A project with no `deployment.preview` — aide itself, PaceUp — must
  // render exactly as it did before this field existed.
  test("no previewUrl, nothing new on either page (criterion 3)", () => {
    const bare = [{ label: "aide", url: "https://example.test/aide" }];
    const html = queueRows({ branchUrls: bare });
    expect(html).not.toContain(">preview</a>");
    expect(html).toContain('href="https://example.test/aide"');
  });

  // The specs repo holds a plan. There is nothing to try in it, whatever
  // the project's manifest says.
  test("only the repo that carries the preview link gets one (criterion 4)", () => {
    const html = queueRows({
      state: "done",
      branchUrls: [
        { label: "aide", url: "https://example.test/aide", previewUrl: PREVIEW },
        { label: "aide-specs", url: "https://example.test/aide-specs" },
      ],
    });
    expect(html.match(/>preview<\/a>/g)).toHaveLength(1);
  });
});
// --- spec 86: one row per spec, with its phases beneath ----------------------

// A spec taken through analyze, implement and archive as
// three separate jobs used to occupy three rows, repeating its own name on
// every one. It is ONE spec, and how far it has got should read without
// counting rows.
describe("the queue list groups by spec (criteria 1-7, 12)", () => {
  const job = (id: string, step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({ id, specFolder: "86-grouped", steps: [step], stepIndex: 0, state: "done", ...extra });

  // Every spec open: this block is about what an expanded row holds —
  // its phase lines, its action cell — which is what every row held
  // before spec 103 made collapsed the default.
  const rows = (list: QueueRowView[]) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets: [], filter: { open: openKeys(list) } },
      Date.parse("2026-08-17T12:00:00Z"),
    );

  const heads = (html: string) => html.match(/<tr class="[^"]*spechead/g) ?? [];
  /** This block's spec page — where every phase line points since spec
   *  237, one tab or another. */
  const GROUPED_HREF = "/specs/aide/86-grouped";
  // The cell for one phase, from its name to the end of the row.
  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";

  test("two jobs for one spec make one header row, not two (criterion 1)", () => {
    const html = rows([
      job("j1", "analyze", { startedAt: "2026-08-16T09:00:00Z" }),
      job("j2", "implement", { startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    expect(heads(html)).toHaveLength(1);
  });

  test("a phase that never ran keeps its place in the order (criterion 2)", () => {
    const html = rows([job("j1", "analyze"), job("j2", "implement")]);
    const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["create", "analyze", "implement", "archive"]);
    expect(subRow(html, "archive")).toContain("not run yet");
  });

  test("a phase that never ran is drawn like any other, not half-lit", () => {
    // Asked for 2026-08-20: a control is enabled or disabled, with
    // nothing in between. A row at 55% opacity reads as a disabled
    // control, and these boxes are not disabled — they tick, and a run
    // starts. The State column already says "not run yet" in words,
    // which is the same fact without the ambiguity.
    const html = rows([job("j1", "analyze")]);

    expect(subRow(html, "implement")).toContain("not run yet");
    expect(html).not.toContain("untried");
  });

  test("a phase run twice shows the latest attempt and the count (criterion 3)", () => {
    const html = rows([
      job("older", "analyze", { state: "failed", startedAt: "2026-08-16T09:00:00Z" }),
      job("newer", "analyze", { state: "done", startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    const analyze = subRow(html, "analyze");
    // Spec 237: the line points at the phase's own tab, not at either
    // attempt's job page — the count beside it is what says there were
    // two, and the picker on the page is what opens the older one.
    expect(analyze).toContain(`href="${GROUPED_HREF}?tab=solution"`);
    expect(analyze).not.toContain('href="/specs/newer"');
    expect(analyze).not.toContain('href="/specs/older"');
    expect(analyze).toContain("2 attempts");
    expect(html.match(/data-step="analyze"/g)).toHaveLength(1);
  });

  test("the header shows what is in flight, not what finished (criterion 4)", () => {
    const html = rows([
      job("j1", "analyze", { state: "done", startedAt: "2026-08-16T11:00:00Z" }),
      job("j2", "implement", { state: "running", startedAt: "2026-08-16T09:00:00Z" }),
    ]);
    expect(heads(html)[0]).toBeDefined();
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    expect(head).toContain('class="badge b-running"');
    expect(head).not.toContain('class="badge b-done"');
  });

  test("with nothing in flight the header shows the latest outcome (criterion 5)", () => {
    const html = rows([
      job("j1", "analyze", { state: "failed", startedAt: "2026-08-16T09:00:00Z" }),
      job("j2", "implement", { state: "done", startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    // Spec 132: a resting `done` badge reads the resting state and what
    // is next, so it wears `b-ready` here. What it must not read is the
    // OLDER job's outcome, which would still be the bare word "failed".
    expect(head).toContain('class="badge b-ready"');
    expect(head).toContain(">ready<");
    expect(head).not.toContain('class="badge b-refused"');
  });

  test("the header's cost is the whole spec's, not one job's (criterion 6)", () => {
    const html = rows([
      job("j1", "analyze", { spentUsd: 1.2 }),
      job("j2", "implement", { spentUsd: 0.8 }),
    ]);
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    expect(head).toContain("$2.00");
  });

  test("the repo list appears once, on the header (criterion 7)", () => {
    const html = rows([
      job("j1", "analyze", {
        startedAt: "2026-08-16T09:00:00Z",
        branchUrls: [{ label: "aide", url: "https://example.test/old" }],
      }),
      job("j2", "implement", {
        startedAt: "2026-08-16T11:00:00Z",
        branchUrls: [{ label: "aide", url: "https://example.test/compare" }],
      }),
    ]);
    // One entry per REPO, on the spec's header and not on each job.
    expect(html.split('class="branch"').length - 1).toBe(1);
    // The link comes from the most recently active job, not an older one.
    expect(html).toContain("https://example.test/compare");
    expect(html).not.toContain("https://example.test/old");
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    expect(head).toContain('class="branchlist"');
  });

  test("the action sits once on the header, never on a phase line (criterion 12)", () => {
    const html = rows([
      job("j1", "analyze", { state: "done", startedAt: "2026-08-16T09:00:00Z" }),
      job("j2", "implement", { state: "running", startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    expect(html.match(/<tr class="subrow/g)).toHaveLength(4);
    expect(html.match(/<form method="post" action="\/api\/queue\/j2\/cancel"/g)).toHaveLength(1);
    // Approve/cancel is the SPEC's one action and belongs on the header —
    // as, since spec 94, does the form that runs the spec's phases. A
    // phase line is read-only.
    for (const phase of ["create", "analyze", "implement", "archive"]) {
      expect(subRow(html, phase)).not.toContain("/cancel");
      expect(subRow(html, phase)).not.toContain("/approve");
    }
  });

  test("two different specs keep their own header rows", () => {
    const html = rows([job("j1", "analyze"), job("j2", "analyze", { specFolder: "87-other" })]);
    expect(heads(html)).toHaveLength(2);
  });

  // Spec 116: create is the FIRST phase line, not a straggler appended
  // after archive — and it appears exactly once, never twice.
  test("a create job leads the phase list, once (spec 116, criterion 8)", () => {
    const html = rows([job("j1", "analyze"), job("j2", "create")]);
    const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["create", "analyze", "implement", "archive"]);
    expect(subRow(html, "create")).toContain(`href="${GROUPED_HREF}?tab=description"`);
  });

  test("a step outside the four is still shown, never silently dropped", () => {
    const html = rows([job("j1", "analyze"), job("j2", "explore")]);
    const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["create", "analyze", "implement", "archive", "explore"]);
    // Spec 237, criterion 3: a step outside the fixed workflow has no
    // tab that speaks for it, so its line keeps the job page it has
    // always had.
    expect(subRow(html, "explore")).toContain('href="/specs/j2"');
  });

  // Spec 271: a reopen is what STARTED this round, so it is drawn
  // between create and analyze, where it happened — not appended after
  // archive with every other step outside the fixed four.
  test("a reopen sits between create and analyze, where it happened (spec 271)", () => {
    const html = rows([
      job("j1", "reopen", { startedAt: "2026-08-15T09:00:00Z" }),
      job("j2", "analyze", { startedAt: "2026-08-16T09:00:00Z" }),
      job("j3", "implement", { startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["create", "reopen", "analyze", "implement", "archive"]);
    expect(subRow(html, "reopen")).toContain("disabled");
  });

  // Spec 237, criteria 1-2: all four legs of the mapping, not just the
  // two that happened to be asserted elsewhere.
  test("each of the four phases opens the tab that shows what it made", () => {
    const html = rows([
      job("j1", "create"),
      job("j2", "analyze"),
      job("j3", "implement"),
      job("j4", "archive"),
    ]);
    const expected: [string, string][] = [
      ["create", "description"],
      ["analyze", "solution"],
      ["implement", "status"],
      ["archive", "overview"],
    ];
    for (const [step, tab] of expected) {
      expect([step, subRow(html, step).includes(`href="${GROUPED_HREF}?tab=${tab}"`)]).toEqual([step, true]);
    }
  });

  // Spec 237, criterion 4: the tab exists whether or not the phase has
  // run, so there is somewhere honest to point even with no attempt —
  // which is what made the name plain text before.
  test("a phase with no attempt at all is a link too", () => {
    const html = rows([job("j1", "analyze")]);
    const implement = subRow(html, "implement");
    expect(implement).toContain("not run yet");
    expect(implement).toContain(`href="${GROUPED_HREF}?tab=status"`);
  });
});
// --- a job that ran several steps belongs on all of them ---------------------

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

  test("never-run specs form a stable block at the bottom (criterion 7)", () => {
    const html = rows(
      [job("j1", "analyze", { startedAt: "2026-08-16T09:00:00Z" })],
      [target("90-has-run"), target("88-never"), target("89-never")],
    );
    const order = [...html.matchAll(/<tr class="[^"]*spechead[^"]*"[^>]*data-folder="([^"]+)"/g)].map(
      (m) => m[1],
    );
    // The higher-numbered folder comes first within the block.
    expect(order).toEqual(["90-has-run", "89-never", "88-never"]);
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

  test("a never-run spec's Cost and Started are dashes (criterion 9)", () => {
    const line = head(rows([], [target("90-never-run")]), "90-never-run");
    expect(line).not.toContain("$0.00");
    expect(line).not.toContain("Invalid Date");
    expect(line).not.toContain("NaN");
    // Two dashes: one for Started, one for Cost — plus the action cell.
    expect(line.match(/–/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("with neither jobs nor targets the page says there is no spec (criterion 10)", () => {
    const html = rows([], []);
    expect(html).toContain("No spec");
    expect(html).not.toContain("Pick a spec above");
  });
});
// --- spec 90: a spec's phases fold away --------------------------------------

// Adding a row for every spec that has never run makes the list longer,
// and folding is what keeps it readable. The state is a query parameter,
// so it survives the five-second swap of the table by the mechanism the
// filter and the sort already ride on.
//
// Spec 103 turned the polarity round: the key is `open`, it names the
// rows shown EXPANDED, and a row nobody named is collapsed. The claims
// below are the same ones spec 90 made — one spec's fold state leaves
// the others alone, a key naming no spec is inert, every filter and
// sort link carries the state forward — asked of the new default.
describe("a spec's phases fold away (criteria 11-15)", () => {
  const target = (specFolder: string): QueueTarget => ({ project: "aide", specFolder });

  const rows = (targets: QueueTarget[], filter?: QueuePageOptions["filter"]) =>
    renderQueueRows(
      [],
      { runnerAvailable: true, targets, filter },
      Date.parse("2026-08-17T12:00:00Z"),
    );

  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";

  test("a spec nobody has opened reads as shut, and its control opens it (criterion 11)", () => {
    const html = rows([target("90-x")]);
    const line = head(html, "90-x");
    expect(line).toContain('aria-expanded="false"');
    expect(html).not.toContain('<tr class="subrow');
    // Percent-encoded, because `queueHref` encodes each value. The raw
    // key appears in no href under any implementation.
    expect(line).toContain("open=aide%2F90-x");
  });

  test("an opened spec gains its phase lines, and its control shuts it again (criterion 12)", () => {
    const html = rows([target("90-x")], { open: "aide/90-x" });
    const line = head(html, "90-x");
    expect(line).not.toBe("");
    expect(html.match(/<tr class="subrow/g)).toHaveLength(4);
    expect(line).toContain('aria-expanded="true"');
    // Its own control now SHUTS it: the encoded key is gone from its href.
    expect(line).not.toContain("open=aide%2F90-x");
  });

  // The control was a text glyph (▸/▾) in a 1rem box: barely visible,
  // and a target nobody could hit. It is an SVG chevron in a 24px flat
  // now, and the state is on the element, not in the glyph.
  test("the fold control is an SVG chevron, open and shut told apart by a class", () => {
    const opened = head(rows([target("90-x")], { open: "aide/90-x" }), "90-x");
    expect(opened).toMatch(/<a class="fold"[^>]*aria-expanded="true"[^>]*><svg/);
    expect(opened).not.toContain("▾");
    const shut = head(rows([target("90-x")]), "90-x");
    expect(shut).toMatch(/<a class="fold shut"[^>]*aria-expanded="false"[^>]*><svg/);
    expect(shut).not.toContain("▸");
  });

  test("opening one spec leaves the other shut (criterion 13)", () => {
    const html = rows([target("90-x"), target("90-y")], { open: "aide/90-x" });
    expect(html.match(/<tr class="subrow/g)).toHaveLength(4);
    for (const step of ["create", "analyze", "implement", "archive"]) {
      expect(html).toContain(`data-step="${step}"`);
    }
    expect(head(html, "90-y")).toContain('aria-expanded="false"');
    // The other spec's own control keeps the opened key and adds its
    // own — the whole filter travels through `queueHref`.
    expect(head(html, "90-y")).toContain("open=aide%2F90-x%2Caide%2F90-y");
  });

  test("an open key naming no spec leaves every real spec collapsed (criterion 14)", () => {
    const html = rows([target("90-x")], { open: "aide/nope" });
    expect(html).not.toContain('<tr class="subrow');
    expect(head(html, "90-x")).toContain('aria-expanded="false"');
  });

  test("the filter, sort and project links keep the fold (criterion 15)", () => {
    const html = rows([target("90-x"), target("90-y")], { open: "aide/90-x", state: "active" });
    // Every state chip and every sortable column header keeps it.
    const links = [...html.matchAll(/<a data-nav href="([^"]+)"/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(4);
    for (const href of links) expect(href).toContain("open=aide%2F90-x");
  });

  // Spec 100: the list answers at `/`, so every link it builds for
  // itself is rooted there — `/specs` would cost a redirect hop on
  // every sort, filter and fold click.
  test("the filter, sort and fold links are rooted at / , not /specs", () => {
    const html = rows([target("90-x"), target("90-y")], { open: "aide/90-x", state: "active" });
    const links = [...html.matchAll(/<a data-nav href="([^"]+)"/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(4);
    for (const href of links) {
      expect(href).toMatch(/^\/(\?|$)/);
    }
  });
});

// Spec 97: the row says when the plan describes an older problem than
// the description does. Nothing is blocked — a person who knows the
// edit was cosmetic can still start `implement`; the page just stops
// pretending the plan is current.
describe("the description-changed badge (criteria 1, 3)", () => {
  const job = (id: string, step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({ id, specFolder: "97-stale", steps: [step], stepIndex: 0, state: "done", ...extra });

  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  // The badge sits on the analyze PHASE LINE, which a collapsed row
  // does not draw at all — so every example here opens its spec.
  const rows = (list: QueueRowView[], targets: QueueTarget[]) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) } },
      Date.parse("2026-08-18T12:00:00Z"),
    );

  /** The line the phase boxes are on, under the header (spec 109). */
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

  // The path every example in the ticket takes: 93, 94 and 96 had all
  // actually run an analyze, so a badge wired only into `emptyGroup`
  // would never fire for any of them.
  test("a spec with job history carries it on the analyze line (criterion 1)", () => {
    const html = rows([job("j1", "analyze")], [target("97-stale", { analyzeStale: true })]);
    expect(subRow(html, "analyze")).toContain("description changed since");
    for (const phase of ["implement", "archive"]) {
      expect(subRow(html, phase)).not.toContain("description changed since");
    }
  });

  // Where the mark sits, not just that it is there. Beside the model
  // picker it had no width of its own, so two lines of free text
  // stretched the name column and took the table sideways with it
  // (2026-08-20). The name cell holds the phase's name and nothing
  // else since spec 165; state goes in the state cell.
  test("the stale mark sits in the state cell, not beside the model picker", () => {
    const html = rows([job("j1", "analyze")], [target("97-stale", { analyzeStale: true })]);
    const line = subRow(html, "analyze");
    const nameCell = line.match(/<td class="phasecell">[\s\S]*?<\/td>/)?.[0] ?? "";
    expect(nameCell).not.toContain("description changed since");
    expect(line).toContain("description changed since");
  });

  test("the attempt count sits in the state cell too", () => {
    const html = rows(
      [job("j1", "analyze"), job("j2", "analyze")],
      [target("97-tries", {})],
    );
    const line = subRow(html, "analyze");
    const nameCell = line.match(/<td class="phasecell">[\s\S]*?<\/td>/)?.[0] ?? "";
    if (line.includes("attempts")) expect(nameCell).not.toContain("attempts");
  });

  test("a spec nothing has run carries it too (criterion 1)", () => {
    const html = rows([], [target("97-never-run", { analyzeStale: true })]);
    expect(subRow(html, "analyze")).toContain("description changed since");
  });

  test("a spec whose description has not moved carries nothing (criterion 4)", () => {
    const html = rows([job("j1", "analyze")], [target("97-stale")]);
    expect(html).not.toContain("description changed since");
  });

  // `done` is what the server has already stripped `analyze`
  // out of; the row's job is to pre-tick the first phase
  // that is left, which is analyze — not implement.
  test("analyze is pre-ticked again, not implement (criterion 3)", () => {
    const html = rows(
      [job("j1", "analyze"), job("j2", "implement")],
      [target("97-stale", { analyzeStale: true, done: ["implement"] })],
    );
    const line = runLine(html, "97-stale");
    expect(line).toMatch(/value="analyze" checked/);
    // `implement` is done, so its box reads ticked and locked (spec
    // 267) rather than pre-ticked — never a `name="steps"` field a
    // press could re-submit.
    expect(line).not.toMatch(/name="steps" value="implement"/);
    // `analyze` and `archive` are what is left to run, so both carry a
    // tickable, named box, and `implement` does not (spec 200).
    // `create`'s box is ticked too and always is — it is the phase
    // already behind you, not a phase a press would run — so it is
    // counted out by its own lack of a field name, exactly as
    // `implement`'s finished box now is too.
    expect([...line.matchAll(/name="steps" value="[^"]*" checked/g)]).toHaveLength(2);
  });
});
// --- spec 99: the view survives an action, and a refusal finds its row ------

// Pressing Run, Approve, Cancel or Merge used to drop the reader back
// on the default view: the redirect after the POST can only carry
// forward what the POST itself received, and none of the three forms
// sent anything about the current filter.
describe("every action form carries the current view (criterion 7)", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (list: QueueRowView[], targets: QueueTarget[], opts: Partial<QueuePageOptions> = {}) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, ...opts },
      Date.parse("2026-08-18T12:00:00Z"),
    );

  /** The Run form and Cancel are on the line an open row reveals under
   *  its header (spec 109). */
  const runLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";

  const FILTER = { state: "all", project: "aide", sort: "spec", dir: "desc", open: "aide/99-x" };

  test("the Run form sends every filter key (criterion 7)", () => {
    const line = runLine(rows([], [target("99-x")], { filter: FILTER }), "99-x");
    for (const [key, value] of Object.entries(FILTER)) {
      expect(line).toContain(`<input type="hidden" name="view.${key}" value="${value}">`);
    }
  });

  // `project` is the collision: the Run form already posts a field of
  // that name to say WHICH spec to run, and two of them arrive as a
  // list that the enqueue refuses as "invalid project".
  test("the view's project never collides with the Run form's own (criterion 7)", () => {
    const line = runLine(rows([], [target("99-x")], { filter: FILTER }), "99-x");
    expect(line).toContain(`<input type="hidden" name="project" value="aide">`);
    expect([...line.matchAll(/name="project"/g)]).toHaveLength(1);
  });

  // Nothing is sent that the view does not hold: the row is open, so
  // the Run form is there to carry the fields, and the only key set is
  // the only key posted.
  test("a key the view does not hold is not sent (criterion 7)", () => {
    const line = runLine(rows([], [target("99-x")], { filter: { open: "aide/99-x" } }), "99-x");
    expect(line).toContain('<input type="hidden" name="view.open" value="aide/99-x">');
    for (const key of ["state", "project", "sort", "dir"]) {
      expect(line).not.toContain(`name="view.${key}"`);
    }
  });

  test("the Cancel form sends them too (criterion 7)", () => {
    const running = row({ id: "j1", specFolder: "99-x", state: "running" });
    // Cancel belongs to the open row — a collapsed one offers Approve
    // or Merge and nothing else (spec 103) — and since spec 109 that
    // means the line the open row reveals, not the header's own cell.
    const line = runLine(
      rows([running], [target("99-x")], { filter: { state: "active", open: "aide/99-x" } }),
      "99-x",
    );
    const form = line.match(/<form method="post" action="\/api\/queue\/j1\/cancel"[^>]*>.*?<\/form>/)![0];
    expect(form).toContain('<input type="hidden" name="view.state" value="active">');
  });

});

// The page lists up to 25 rows, so a refusal shown once at the top of
// the page does not say WHICH row it is about.
describe("a refusal is shown on the row it belongs to (criteria 8, 12)", () => {
  const target = (specFolder: string): QueueTarget => ({ project: "aide", specFolder });

  const rows = (targets: QueueTarget[], opts: Partial<QueuePageOptions> = {}) =>
    renderQueueRows(
      [],
      { runnerAvailable: true, targets, ...opts },
      Date.parse("2026-08-18T12:00:00Z"),
    );

  /** The row's head AND the message panel under it. Spec 151 moved the
   *  refusal out of the name cell and into that panel, so a matcher
   *  that stopped at the first `</tr>` would no longer see the text
   *  this block is about. */
  const head = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";

  test("the named spec's row carries the reason, and no other row does (criterion 8)", () => {
    const html = rows([target("99-x"), target("99-y")], {
      error: "the tree is dirty in /repos/aide",
      errorSpec: "aide/99-x",
    });
    expect(head(html, "99-x")).toContain("the tree is dirty in /repos/aide");
    expect(head(html, "99-y")).not.toContain("the tree is dirty");
  });

  test("an errorSpec naming another project leaves the row alone (criterion 8)", () => {
    const html = rows([target("99-x")], { error: "refused", errorSpec: "paceup/99-x" });
    expect(head(html, "99-x")).not.toContain("refused");
  });

  test("the page-top banner is not shown as well when a row has it (criterion 12)", () => {
    const page = renderQueuePage([], "2026-08-18T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [target("99-x")],
      error: "the tree is dirty in /repos/aide",
      errorSpec: "aide/99-x",
    });
    expect(page).not.toContain('<p class="refusal">');
    // …and the reason is still on the page, on its row.
    expect(page).toContain("the tree is dirty in /repos/aide");
  });

  test("a refusal that belongs to no row keeps the banner (criterion 12)", () => {
    const page = renderQueuePage([], "2026-08-18T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [target("99-x")],
      error: "payload too large",
    });
    expect(page).toContain('<p class="refusal rowmsg err">');
    expect(page).toContain("payload too large");
  });
});

// Spec 100 made the spec list the front page and dropped the nav's own
// "Specs" entry; spec 119 brought it back as one of the two tabs, at
// `/` — the front page still, and still what the wordmark points at.
// The old /specs address is linked from nowhere either way.
describe("spec 119: the list page's own tab", () => {
  test("renderQueuePage marks Specs current, points it at /, and keeps the wordmark home", () => {
    const html = renderQueuePage(
      [],
      "2026-08-18T00:00:00Z",
      [{ label: "Overview", path: "projects.html" }],
      { runnerAvailable: true, targets: [] },
    );
    const navHtml = html.match(/<nav[^>]*>[\s\S]*?<\/nav>/)![0];
    expect(navHtml).toContain('<a class="tab" data-nav data-goto href="/" aria-current="page">Specs</a>');
    expect(html).not.toContain('href="/specs"');
    expect(html).toContain('<a class="brand" href="/">');
    // The Projects tab points wherever the caller's first entry does —
    // the served route in production, this stand-in here.
    expect(navHtml).toContain('href="projects.html"');
  });
});

describe("an unmeasured cost is marked where it is totalled", () => {
  const marker = '<span class="muted small">est.</span>';

  test("the job page's overview total is marked when a summed step was over-charged", () => {
    const html = renderJobDetailPage(
      detail({
        steps: ["implement"],
        stepIndex: 0,
        state: "stopped",
        stopReason: "timeout",
        spentUsd: 35,
        results: [
          {
            step: "implement", ok: false, costUsd: 35, costMeasured: false,
            terminalReason: "timeout", at: "2026-08-21T07:58:00Z",
          },
        ],
      }),
      "2026-08-21T08:00:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(html).toContain("Cost so far");
    expect(html).toContain(marker);
  });

  test("a job whose every step was measured carries no marker on its total", () => {
    const html = renderJobDetailPage(
      detail({
        state: "done",
        spentUsd: 0.42,
        results: [
          {
            step: "analyze", ok: true, costUsd: 0.42, costMeasured: true,
            terminalReason: "completed", at: "2026-08-21T10:01:00Z",
          },
        ],
      }),
      "2026-08-21T10:05:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(html).toContain("Cost so far");
    expect(html).not.toContain(marker);
  });

  // The row's own cell is a roll-up across every job the spec has had,
  // which is the "41.13 USD for 149" figure the incident was about.
  const spentRow = (extra: Partial<QueueRowView>): QueueRowView =>
    row({ state: "done", ...extra });

  test("the spec row's total is marked when any job under it was over-charged", () => {
    const html = renderQueueRows(
      [
        spentRow({
          id: "j1", steps: ["analyze"], spentUsd: 6.13,
          results: [{ step: "analyze", ok: true, costUsd: 6.13, costMeasured: true }],
        }),
        spentRow({
          id: "j2", steps: ["implement"], state: "stopped", stopReason: "timeout", spentUsd: 35,
          results: [{ step: "implement", ok: false, costUsd: 35, costMeasured: false }],
        }),
      ],
      { runnerAvailable: true, targets: [] },
      Date.parse("2026-08-21T12:00:00Z"),
    );
    expect(html).toContain("$41.13");
    expect(html).toContain(marker);
  });

  test("a spec whose every step was measured renders no marker", () => {
    const html = renderQueueRows(
      [
        spentRow({
          id: "j1", steps: ["analyze"], spentUsd: 6.13,
          results: [{ step: "analyze", ok: true, costUsd: 6.13, costMeasured: true }],
        }),
      ],
      { runnerAvailable: true, targets: [] },
      Date.parse("2026-08-21T12:00:00Z"),
    );
    expect(html).toContain("$6.13");
    expect(html).not.toContain(marker);
  });

  // The phase lines answer for their OWN attempt, so the marker has to
  // be decided per line rather than inherited from the row above them.
  test("an expanded phase line marks its own attempt, and a measured one beside it does not", () => {
    const rows = [
      spentRow({
        id: "j1", steps: ["analyze"], spentUsd: 6.13,
        results: [{ step: "analyze", ok: true, costUsd: 6.13, costMeasured: true }],
      }),
      spentRow({
        id: "j2", steps: ["implement"], state: "stopped", stopReason: "timeout", spentUsd: 35,
        results: [{ step: "implement", ok: false, costUsd: 35, costMeasured: false }],
      }),
    ];
    const html = renderQueueRows(
      rows,
      { runnerAvailable: true, targets: [], filter: { open: "aide/81-queue-and-runner" } },
      Date.parse("2026-08-21T12:00:00Z"),
    );
    const implementLine = html.slice(html.indexOf('data-step="implement"'));
    const analyzeLine = html.slice(html.indexOf('data-step="analyze"'), html.indexOf('data-step="implement"'));
    expect(implementLine.slice(0, implementLine.indexOf("</tr>"))).toContain(marker);
    expect(analyzeLine).toContain("$6.13");
    expect(analyzeLine).not.toContain(marker);
  });
});

// --- spec 220: the pull request a run left open ------------------------------
//
// A project that reviews its code archives with the code still on its
// branch, and a pull request describing it. The row is where a reader
// finds out — the same line that carries the compare links — and a `gh`
// that could not open the request has to say so there too, or an
// orphaned open branch looks exactly like a reviewed one.
describe("a row shows the pull request its run opened (spec 220)", () => {
  const open = (extra: Partial<QueueRowView>): string =>
    renderQueueRows([row({ steps: ["archive"], state: "done", ...extra })], {
      runnerAvailable: true,
      targets: [],
    });

  test("the link is on the row, beside the branch it is for", () => {
    const html = open({ prUrl: "https://github.test/aide/pull/7" });
    expect(html).toContain('href="https://github.test/aide/pull/7"');
    expect(html.toLowerCase()).toContain("pull request");
  });

  test("a gh that could not open one says so instead", () => {
    const html = open({ prError: "gh auth login required" });
    expect(html).toContain("gh auth login required");
    expect(html).not.toContain("pull/7");
  });

  test("a row with neither is the row it has always been", () => {
    const html = open({});
    expect(html.toLowerCase()).not.toContain("pull request");
  });
});
