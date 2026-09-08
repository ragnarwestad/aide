// Split out of spec-list-rendering.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import {
  renderQueuePage,
  renderQueueRows,
  type ArchivedSpecView,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../src/render.ts";
import { TOKEN, JOB, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

// One list, with the sorting and filtering that makes a fixed "Active"
// section unnecessary: asking for the running jobs is a filter, not a
// second table.
describe("the job list sorts and filters", () => {
  const row = (id: string, extra: Partial<QueueRowView> = {}): QueueRowView => ({
    id,
    project: "aide",
    specFolder: `${id}-spec`,
    steps: ["analyze"],
    stepIndex: 0,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-16T00:00:00Z",
    ...extra,
  });

  /** A spec on disk, as the server hands it to the page. `createdAt` is
   *  what git answered for the folder's first commit (spec 199). */
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  /** The specs down the page, in the order they are drawn — off the
   *  header rows alone: `data-folder` is written more than once per
   *  spec, and a bare match counts a row twice. */
  const specOrder = (html: string): (string | undefined)[] =>
    [...html.matchAll(/<tr class="[^"]*spechead[^"]*"[^>]*data-folder="([^"]+)"/g)].map((m) => m[1]);

  /** One spec's own Started cell, off its header row. */
  const startedCell = (html: string, folder: string): string =>
    html
      .match(new RegExp(`<tr class="spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0]
      .match(/<td data-col="started">.*?<\/td>/)?.[0] ?? "";

  const page = (
    rows: QueueRowView[],
    filter?: QueuePageOptions["filter"],
    // Spec 199: a creation date comes off the TARGET (git), never off a
    // job. Spec 281 stopped drawing it in the Time column at all — that
    // column shows the spec's summed duration now — but `createdAt`
    // still decides the folder-order tie-break between two specs
    // neither git nor a job can date (below), so tests about that still
    // need a target to give one on.
    targets: QueueTarget[] = [],
    archivedSpecs?: ArchivedSpecView[],
  ) =>
    renderQueuePage(rows, "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets,
      filter,
      archivedSpecs,
      archived: archivedSpecs?.map((s) => `${s.project}/${s.folder}`),
    });

  /** The minimum an `ArchivedSpecView` needs to render a row — every
   *  field the row markup or the sort touches, and nothing else. */
  const archived = (folder: string, extra: Partial<ArchivedSpecView> = {}): ArchivedSpecView => ({
    project: "aide",
    folder,
    archivedAt: "2026-08-01",
    done: [],
    models: {},
    phaseOutcomes: {},
    ...extra,
  });

  test("one table holds every job — no fixed section above it", () => {
    const html = page([row("a", { state: "running" }), row("b")]);
    expect(html.match(/<table class="list speclist"/g)).toHaveLength(1);
    expect(html).toContain("a-spec");
    expect(html).toContain("b-spec");
  });

  test("the state filter is offered with a count on each choice", () => {
    const html = page([row("a", { state: "running" }), row("b"), row("c", { state: "failed" })]);
    expect(html).toMatch(/>All \(3\)</);
    expect(html).toMatch(/>Running \(1\)</);
    expect(html).toMatch(/>Done \(1\)</);
    expect(html).toMatch(/>Problems \(1\)</);
  });

  test("asking for active work leaves the finished jobs out", () => {
    const rows = [row("a", { state: "running" }), row("b"), row("c", { state: "queued" })];
    const html = page(rows, { state: "active" });
    expect(html).toContain("a-spec");
    expect(html).toContain("c-spec");
    expect(html).not.toContain("b-spec");
  });

  test("a stopped job is a problem, not a success", () => {
    const html = page([row("a", { state: "stopped" }), row("b")], { state: "problem" });
    expect(html).toContain("a-spec");
    expect(html).not.toContain("b-spec");
  });

  // A chip per project stood above the list until 2026-08-23: one
  // control that grew with the machine, and nobody had asked to filter
  // by project. Every spec is listed now, whatever project it is from.
  test("no project filter is drawn, however many projects there are", () => {
    const rows = [row("a"), row("b", { project: "aide-dashboard" })];
    const html = page(rows);
    expect(html).not.toContain('data-filter="project"');
    expect(html).toContain("a-spec");
    expect(html).toContain("b-spec");
  });

  // Spec 317 (REQ-3): the default view is the newest spec MADE at the
  // top — by its own creation date, not by folder number (which was the
  // default from 2026-08-19 until this changed it: activity order put a
  // spec that had just been created at the bottom, under everything
  // that had ever run; folder order sorted the same way for as long as
  // numbers kept increasing, until a spec's folder was renumbered on
  // reopen and the two stopped agreeing). Folder order is still one
  // click away on the Spec column.
  test("newest CREATED spec first is the default order (REQ-3)", () => {
    const html = page([], undefined, [
      target("104-first", { createdAt: "2026-08-10T09:00:00Z" }),
      target("109-second", { createdAt: "2026-08-16T09:00:00Z" }),
    ]);
    expect(html.indexOf("109-second")).toBeLessThan(html.indexOf("104-first"));
    expect(html).toMatch(
      /<th class="" data-col="created" aria-sort="descending"><a class="sortlink on"[^>]*>Created<svg/,
    );
  });

  // REQ-2: the Created column sorts like every other — a click turns it
  // round. Folder numbers run the OPPOSITE way from creation date here,
  // so a sort that silently fell back to folder order would fail this
  // exactly as it would pass the default-order test above by accident.
  test("the Created column sorts ascending on request, oldest first", () => {
    const html = page([], { sort: "created", dir: "asc" }, [
      target("109-earlier", { createdAt: "2026-08-10T09:00:00Z" }),
      target("104-later", { createdAt: "2026-08-16T09:00:00Z" }),
    ]);
    expect(html.indexOf("109-earlier")).toBeLessThan(html.indexOf("104-later"));
  });

  // Spec 208's REQ-5 sorted an undated spec as the epoch, so it never
  // floated to the top of a newest-first list. Reversed: the cell reads
  // "–" because git has not caught up with a folder made moments ago,
  // so the spec that is certainly the newest was the one sent to the
  // bottom. It sorts as the newest now, and still never crashes the sort.
  test("a spec with no creation date sorts as the newest", () => {
    const html = page([], { sort: "created" }, [
      target("50-dated", { createdAt: "2026-08-10T09:00:00Z" }),
      target("51-undated"),
    ]);
    expect(html.indexOf("51-undated")).toBeLessThan(html.indexOf("50-dated"));
  });

  // REQ-2/REQ-6, the exact gap plan review's must-fix 1 found: an
  // archived row's `createdAt` has to reach the same sort key a live
  // row's does, or every archived row ties at "unknown" regardless of
  // its real date. Folder numbers again run the opposite way from the
  // real dates, so a sort reading the wrong field (or none) fails this.
  test("an archived row sorts by its own real creation date, not always as unknown", () => {
    const html = page(
      [],
      { sort: "created" },
      [],
      [
        archived("61-older-archive", { createdAt: "2026-08-01T09:00:00Z" }),
        archived("60-newer-archive", { createdAt: "2026-08-20T09:00:00Z" }),
      ],
    );
    expect(html.indexOf("60-newer-archive")).toBeLessThan(html.indexOf("61-older-archive"));
  });

  // Spec 199 put the sort on when the spec was MADE, so a spec re-run an
  // hour ago no longer outranked one made this morning. Spec 281 moves
  // it again, onto the same summed duration the column itself now draws
  // — a column that DRAWS one figure has to SORT by it, the same rule
  // spec 273 already applied to the archived half of this sort.
  test("sorting by started puts the spec with the larger summed duration first (spec 281)", () => {
    const html = page(
      [
        row("small", {
          startedAt: "2026-08-16T09:00:00Z",
          results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:05:00Z" }],
        }),
        row("big", {
          startedAt: "2026-08-16T09:00:00Z",
          results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:20:00Z" }],
        }),
      ],
      { sort: "started" },
    );
    expect(specOrder(html)).toEqual(["big-spec", "small-spec"]);
  });

  // Spec 281's own criterion 1 read "a phase being started, finished or
  // run again must not move a row whose OWN settled total has not
  // changed" — because a live phase contributed nothing to the total
  // back then. Spec 340's REQ-2 reverses exactly that: a live phase now
  // contributes its own elapsed-so-far, and the sort reads the same
  // `totalDurationMs` the column draws (`filter-sort.ts`), so a spec
  // with a phase that has been running long enough legitimately outranks
  // one with a smaller SETTLED total — this is the sort staying correct
  // under the new rule, not a regression of criterion 1.
  test("a phase's own live elapsed time counts toward the started sort, same as the column it sorts by (REQ-2)", () => {
    const settled = (id: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
      row(id, {
        startedAt: "2026-08-16T09:00:00Z",
        results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:20:00Z" }],
        ...extra,
      });
    const opts = { runnerAvailable: true, targets: [], filter: { sort: "started" } as const };
    const now = Date.parse("2026-08-16T12:00:00Z");
    // Before: "small" has nothing settled yet, so it sorts behind "big"'s
    // 20 measured minutes.
    const before = renderQueueRows([row("small"), settled("big")], opts, now);
    expect(specOrder(before)).toEqual(["big-spec", "small-spec"]);
    // After: "small" has been running for an hour (11:00 to NOW 12:00) —
    // more than "big"'s 20 settled minutes — so it now sorts FIRST.
    const after = renderQueueRows(
      [row("small", { state: "running", startedAt: "2026-08-16T11:00:00Z" }), settled("big")],
      opts,
      now,
    );
    expect(specOrder(after)).toEqual(["small-spec", "big-spec"]);
  });

  // A spec with no settled phase — no job at all, or nothing has
  // finished yet — has nothing to sum, and the column says so with the
  // same dash `costCell` already uses for zero spend (criterion 2). This
  // used to be "the column falls back to the target's own creation
  // date"; spec 281 removed that fallback along with the date itself.
  test("a spec with no job rows at all shows 0s, not a date (criterion 2)", () => {
    const html = page([], { sort: "started" }, [
      target("77-evicted", { createdAt: "2026-03-01T09:00:00Z" }),
    ]);
    expect(html).toContain("77-evicted");
    // The column answers "how long", so nothing run is `0s` — and the
    // date it once fell back to belongs under Created, one cell left.
    expect(startedCell(html, "77-evicted")).toContain("0s");
    expect(startedCell(html, "77-evicted")).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  // Neither spec can be dated and neither has ever run: the same
  // folder-name-descending fallback the old `activityAt === 0`
  // tie-break gave, and no throw (criterion 8). It passes before the
  // change as well as after — deliberately: the criterion is that this
  // order is PRESERVED while the field the tie-break reads is replaced.
  test("two specs git cannot date fall back to folder order (criterion 8)", () => {
    const html = page([], { sort: "started" }, [target("88-undatable"), target("89-undatable")]);
    expect(specOrder(html)).toEqual(["89-undatable", "88-undatable"]);
  });

  test("sorting by cost puts the expensive job on top", () => {
    const html = page([row("cheap", { spentUsd: 0.5 }), row("dear", { spentUsd: 12 })], {
      sort: "cost",
    });
    expect(html.indexOf("dear-spec")).toBeLessThan(html.indexOf("cheap-spec"));
  });

  test("the same column clicked again turns the order round", () => {
    const html = page([row("cheap", { spentUsd: 0.5 }), row("dear", { spentUsd: 12 })], {
      sort: "cost",
      dir: "asc",
    });
    expect(html.indexOf("cheap-spec")).toBeLessThan(html.indexOf("dear-spec"));
  });

  test("sorting by spec ascending is alphabetical", () => {
    const html = page([row("zz"), row("aa")], { sort: "spec", dir: "asc" });
    expect(html.indexOf("aa-spec")).toBeLessThan(html.indexOf("zz-spec"));
  });

  // Spec folders lead with a number, and the first three-digit one
  // (100, on 2026-08-18) sorted BEFORE 81 as text. The number is what a
  // person reads the column by, so it is what the column sorts by.
  test("sorting by spec orders by the leading number, not by text", () => {
    const html = page([row("103"), row("81"), row("9"), row("104")], { sort: "spec", dir: "asc" });
    const at = (n: string) => html.indexOf(`${n}-spec"`);
    expect(at("9")).toBeLessThan(at("81"));
    expect(at("81")).toBeLessThan(at("103"));
    expect(at("103")).toBeLessThan(at("104"));
  });

  test("a column header is a link that keeps the filter you are already in", () => {
    const html = page([row("a", { state: "running" })], { state: "active" });
    expect(html).toContain('href="/?state=active&amp;sort=cost"');
  });

  test("the sorted column says which way it is going", () => {
    const html = page([row("a")], { sort: "cost" });
    expect(html).toMatch(/aria-sort="descending"/);
  });

  // The direction was a text glyph (▴/▾) glued to the label: faint, and
  // no larger than the letters. It is an SVG chevron now, turned by a
  // class, and the header link is a control with a hover flat.
  test("the sort direction is a chevron, not a glyph", () => {
    const desc = page([row("a")], { sort: "cost" });
    expect(desc).toMatch(
      /<th class="[^"]*" data-col="cost" aria-sort="descending"><a class="sortlink on"[^>]*><span class="u-usd">Cost<\/span>/,
    );
    expect(desc).not.toContain("▾");
    const asc = page([row("a")], { sort: "cost", dir: "asc" });
    expect(asc).toMatch(/<a class="sortlink on asc"[^>]*><span class="u-usd">Cost<\/span>/);
    expect(asc).not.toContain("▴");
    // An unsorted column carries the chevron too (faint in CSS), pointing
    // the way its first click will sort: Time defaults to descending.
    expect(desc).toMatch(/<a class="sortlink"[^>]*>Time<svg/);
    // …and State to ascending, so its chevron is already turned.
    expect(desc).toMatch(/<a class="sortlink asc"[^>]*>State\/Action<svg/);
  });

  test("a filter that matches nothing says so instead of showing a bare table", () => {
    const html = page([row("a")], { state: "active" });
    // "spec", not "job": the table has been one line per spec since
    // spec 86, and since spec 90 it lists specs that have no job at all.
    expect(html).toContain("No spec matches");
  });

  test("the list shows everything, with no cap (spec 226)", () => {
    const html = page(Array.from({ length: 29 }, (_, i) => row(`j${i}`)), { sort: "started" });
    expect(html).toContain("j0-spec");
    expect(html).toContain("j24-spec");
    expect(html).toContain("j28-spec");
  });

  test("the partial refresh carries the controls too, so the filter survives a tick", async () => {
    const { base } = start({ queueToken: TOKEN });
    await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-aide-token": TOKEN, accept: "application/json" },
      body: JSON.stringify(JOB),
    });
    const rows = await (
      await fetch(`${base}/?rows=1&state=active`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    expect(rows).toContain('data-filter="state"');
    expect(rows).toMatch(/aria-checked="true"><span class="check" aria-hidden="true"><\/span>Running/);
  });
});
