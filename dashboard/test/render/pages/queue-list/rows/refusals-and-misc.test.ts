import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderQueuePage,
  renderQueueRows,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../../src/render.ts";
import { NAV, detail, row } from "../../fixtures.ts";

// Split out of grouping.test.ts by theme.





// Spec 99: the view survives an action, and a refusal finds its row ------

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
    expect(page).toContain('<p class="refusal rowmsg failed">');
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
  // which is the "41.13 USD for 149" figure the incident was about. On
  // the list the mark is the figure's own tooltip, not a word beside
  // it: the Cost column is 4.5rem, and the word wrapped onto a line of
  // its own where it read as belonging to the column beside it
  // (2026-09-08).
  const listMarker = 'title="an estimate: a step that was stopped is charged its whole budget';
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
    expect(html).toContain(listMarker);
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
    expect(html).not.toContain(listMarker);
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
    expect(implementLine.slice(0, implementLine.indexOf("</tr>"))).toContain(listMarker);
    expect(analyzeLine).toContain("$6.13");
    expect(analyzeLine).not.toContain(listMarker);
  });
});
