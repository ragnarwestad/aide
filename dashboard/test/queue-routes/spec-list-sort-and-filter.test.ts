// Split out of spec-list-rendering.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import {
  renderQueuePage,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../src/render.ts";
import { TOKEN, JOB, setupQueueRoutesHarness } from "./fixtures.ts";

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
    // Spec 199: "Started" is the spec's own creation date, and a
    // creation date comes off the TARGET (git), never off a job — so a
    // test about that column has to be able to give one.
    targets: QueueTarget[] = [],
  ) =>
    renderQueuePage(rows, "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets,
      filter,
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

  // The default view is the newest SPEC at the top — by number, not by
  // last activity (chosen 2026-08-19: activity order put a spec that
  // had just been created at the bottom, under everything that had
  // ever run). Started is still one click away.
  test("newest spec first is the default order", () => {
    const html = page([
      row("104", { startedAt: "2026-08-16T11:00:00Z" }),
      row("109", { startedAt: "2026-08-16T09:00:00Z" }),
    ]);
    expect(html.indexOf("109-spec")).toBeLessThan(html.indexOf("104-spec"));
    // The Spec heading spans two columns since spec 165 — the phase
    // name's and the row's AI — which is why the attribute is not
    // pinned to sitting straight after the class.
    expect(html).toMatch(
      /<th class="[^"]*" colspan="2" aria-sort="descending"><a class="sortlink on"[^>]*>Spec<svg/,
    );
  });

  // Spec 199: it used to put the most recent ACTIVITY first, so a spec
  // made months ago and re-run an hour ago outranked one made this
  // morning. The column and the sort hold when the spec was MADE now,
  // and a run does not move it.
  test("sorting by started puts the most recently CREATED spec first", () => {
    const html = page(
      // The older spec has the NEWER run, which is what used to decide
      // this order and no longer does.
      [row("old", { startedAt: "2026-08-16T11:00:00Z" }), row("new", { startedAt: "2026-08-16T09:00:00Z" })],
      { sort: "started" },
      [
        target("old-spec", { createdAt: "2026-08-10T09:00:00Z" }),
        target("new-spec", { createdAt: "2026-08-14T09:00:00Z" }),
      ],
    );
    expect(specOrder(html)).toEqual(["new-spec", "old-spec"]);
  });

  // The literal requirement: a phase being started, finished or run
  // again must not move the row. The older spec has the newer run.
  test("a run on an older spec does not move it up the started sort (criterion 1)", () => {
    const targets = [
      target("old-spec", { createdAt: "2026-08-10T09:00:00Z" }),
      target("new-spec", { createdAt: "2026-08-14T09:00:00Z" }),
    ];
    const before = page([row("old"), row("new")], { sort: "started" }, targets);
    const after = page(
      [
        row("old", { state: "running", startedAt: "2026-08-16T11:00:00Z" }),
        row("new", { startedAt: "2026-08-11T09:00:00Z" }),
      ],
      { sort: "started" },
      targets,
    );
    expect(specOrder(after)).toEqual(specOrder(before));
    expect(specOrder(after)).toEqual(["new-spec", "old-spec"]);
  });

  // The 200-job cap is what makes git the only possible source: a spec
  // older than two hundred jobs has no `Job` record left to read a date
  // off. `createdAt` comes off the target and touches no job at all, so
  // a target with NO rows is, for this code, exactly a spec whose job
  // was evicted (criterion 2).
  test("a spec with no job rows at all still shows its Started date (criterion 2)", () => {
    const html = page([], { sort: "started" }, [
      target("77-evicted", { createdAt: "2026-03-01T09:00:00Z" }),
    ]);
    expect(html).toContain("77-evicted");
    expect(html).toContain('title="2026-03-01T09:00:00Z"');
    expect(startedCell(html, "77-evicted")).not.toContain("–");
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
    expect(desc).toMatch(/<a class="sortlink asc"[^>]*>State<svg/);
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
    expect(rows).toMatch(/aria-current="true"[^>]*>Running/);
  });
});
