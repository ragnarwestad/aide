// Split out of spec-list-rendering.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import {
  renderQueuePage,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../src/render.ts";
import { setupQueueRoutesHarness } from "./fixtures.ts";

const { harness } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

// Spec 86: the list is one line per SPEC, so filtering and sorting are
// questions about specs — "which spec has something running?" — not
// about the individual jobs a spec happens to have been split into.
describe("filtering and sorting work on specs, not jobs", () => {
  const job = (id: string, spec: string, extra: Partial<QueueRowView> = {}): QueueRowView => ({
    id,
    project: "aide",
    specFolder: spec,
    steps: ["analyze"],
    stepIndex: 0,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-16T00:00:00Z",
    ...extra,
  });

  // `open` names the specs whose phase lines are drawn: this block
  // asserts that a filtered spec keeps every job it has had, and those
  // are read off the lines an open row draws.
  const page = (
    rows: QueueRowView[],
    filter?: QueuePageOptions["filter"],
    targets: QueueTarget[] = [],
  ) =>
    renderQueuePage(rows, "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets,
      filter: { open: "aide/aa-spec", ...filter },
    });

  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });


  test("a spec with one job in flight is active, one with only finished jobs is not (criterion 8)", () => {
    const html = page(
      [
        job("a1", "aa-spec", { state: "done", startedAt: "2026-08-16T09:00:00Z" }),
        job("a2", "aa-spec", {
          state: "running",
          steps: ["implement"],
          startedAt: "2026-08-16T11:00:00Z",
        }),
        job("b1", "bb-spec", { state: "done" }),
      ],
      { state: "active" },
    );
    expect(html).toContain("aa-spec");
    expect(html).not.toContain("bb-spec");
    // Its finished job comes along with it — the spec is one line, and
    // that line carries every phase it has had, filter or no filter.
    // Since spec 237 a phase line names no job: it opens the tab that
    // shows what the phase MADE, on this spec's own page. The finished
    // analyze and the running implement are therefore read off their
    // two tabs, not off two job pages.
    expect(html.match(/<tr class="spechead/g)).toHaveLength(1);
    expect(html).toContain('href="/specs/aide/aa-spec?tab=solution"');
    expect(html).toContain('href="/specs/aide/aa-spec?tab=status"');
    expect(html).not.toContain('href="/specs/a1"');
    expect(html).not.toContain('href="/specs/a2"');
  });

  test("the filter tabs count specs, not jobs (criterion 9)", () => {
    const html = page([
      job("a1", "aa-spec", { state: "done", startedAt: "2026-08-16T09:00:00Z" }),
      job("a2", "aa-spec", { state: "done", startedAt: "2026-08-16T10:00:00Z" }),
      job("b1", "bb-spec", { state: "running" }),
    ]);
    expect(html).toMatch(/>All \(2\)</);
    expect(html).toMatch(/>Running \(1\)</);
    expect(html).toMatch(/>Done \(1\)</);
  });

  test("sorting by cost uses the spec's total, not one job's (criterion 10)", () => {
    const html = page(
      [
        job("a1", "aa-spec", { spentUsd: 2.5 }),
        job("a2", "aa-spec", { spentUsd: 2.5 }),
        // Dearer than either aa job on its own, cheaper than the two together.
        job("b1", "bb-spec", { spentUsd: 4 }),
      ],
      { sort: "cost" },
    );
    expect(html.indexOf("aa-spec")).toBeLessThan(html.indexOf("bb-spec"));
    expect(html).toContain("$5.00");
  });

  // Spec 226 inverted this. It used to pin a 25-row cap and the "N
  // older specs not shown" line that counted what the cap had dropped.
  // Hiding rows is wrong in every view: the reader cannot find what is
  // not on the page, and the browser's own find is the search the
  // archived and combined views are read with. The cap was a
  // performance guess, and the answer to a payload that turns out to
  // matter is server-side — render only what changed, or cache the
  // fragment — never a cap again.
  test("every spec a filter matches is on the page (criterion 1)", () => {
    const rows = Array.from({ length: 26 }, (_, i) => [
      job(`x${i}`, `s${String(i).padStart(2, "0")}-spec`, {
        startedAt: `2026-08-16T${String(i % 24).padStart(2, "0")}:00:00Z`,
      }),
      job(`y${i}`, `s${String(i).padStart(2, "0")}-spec`, {
        startedAt: `2026-08-16T${String(i % 24).padStart(2, "0")}:30:00Z`,
      }),
    ]).flat();
    const html = page(rows, { sort: "spec", dir: "asc" });
    expect(html).toContain("s00-spec");
    expect(html).toContain("s24-spec");
    // The 26th, the one the cap used to cut.
    expect(html).toContain("s25-spec");
    // The note the cap wrote, by its shape rather than by a word: this
    // is the WHOLE page, and "older" is inside "folder" and inside a
    // comment in the inlined stylesheet.
    expect(html).not.toMatch(/\d+ older specs? not shown/);
    expect(html).not.toContain("not shown.");
  });

  // Spec 261 moved the "?" and New spec off the chips' own row and onto
  // the search field's row beside it — readers look for them next to
  // the field they are about to use, not above it. This replaces the
  // spec-226 guard for the OLD placement: the chips' `<div class="row">`
  // now holds only the chips, and both controls live inside
  // `<form class="specsearch">`, help before New spec.
  test('the "?" and New spec sit on the search field\'s own row (spec 261)', () => {
    const html = renderQueuePage(
      [job("a1", "aa-spec")],
      "2026-08-16T00:00:00Z",
      [{ label: "Overview", path: "projects.html" }],
      { runnerAvailable: true, targets: [], createProjects: ["aide"] },
    );
    const formStart = html.indexOf('<form class="specsearch"');
    expect(formStart).toBeGreaterThan(-1);
    const formEnd = html.indexOf("</form>", formStart);
    expect(formEnd).toBeGreaterThan(-1);
    const form = html.slice(formStart, formEnd);
    // The chips' own row, read by its two ends rather than by a regex:
    // `<div class="row">` occurs elsewhere on the page, and a pattern
    // that backtracked past one of those would be reading a region
    // nobody meant.
    const opens = html.lastIndexOf('<div class="row">', formStart);
    expect(opens).toBeGreaterThan(-1);
    const chipsRow = html.slice(opens, formStart);
    expect(chipsRow).toContain('data-filter="state"');
    expect(chipsRow).not.toContain('<details class="intro">');
    expect(chipsRow).not.toContain(">New spec</a>");
    // Both controls now live inside the search form's own row, help
    // before New spec.
    expect(form).toContain('<details class="intro">');
    expect(form).toContain(">New spec</a>");
    expect(form.indexOf('<details class="intro">')).toBeLessThan(form.indexOf(">New spec</a>"));
    // And the whole row is still ahead of the list it labels.
    expect(html.indexOf('<form class="specsearch"')).toBeLessThan(
      html.indexOf('<div class="tablewrap">'),
    );
  });

  // Every spec is ONE line, so its place in the order is the group's —
  // it can no longer have one job near the top and another near the
  // bottom of the same list.
  const specOrder = (html: string) =>
    [...html.matchAll(/<tr class="[^"]*spechead[^"]*"[^>]*data-folder="([^"]+)"/g)].map((m) => m[1]);

  // Spec 199: the group's place is its spec's CREATION date. `aa-spec`
  // has the newest run of the three jobs here and is still second,
  // because it was made first.
  test("sorting by started uses the spec's creation date, not its jobs (criterion 13)", () => {
    const html = page(
      [
        job("a1", "aa-spec", { state: "running", startedAt: "2026-08-16T08:00:00Z" }),
        job("a2", "aa-spec", { state: "done", startedAt: "2026-08-16T12:00:00Z" }),
        job("b1", "bb-spec", { state: "done", startedAt: "2026-08-16T10:00:00Z" }),
      ],
      { sort: "started" },
      [
        target("aa-spec", { createdAt: "2026-08-01T09:00:00Z" }),
        target("bb-spec", { createdAt: "2026-08-05T09:00:00Z" }),
      ],
    );
    expect(specOrder(html)).toEqual(["bb-spec", "aa-spec"]);
  });

  test("sorting by state uses the spec's representative state (criterion 13)", () => {
    const html = page(
      [
        job("a1", "aa-spec", { state: "running", startedAt: "2026-08-16T08:00:00Z" }),
        job("a2", "aa-spec", { state: "done", startedAt: "2026-08-16T12:00:00Z" }),
        job("b1", "bb-spec", { state: "done", startedAt: "2026-08-16T10:00:00Z" }),
      ],
      { sort: "state" },
    );
    expect(specOrder(html)).toEqual(["bb-spec", "aa-spec"]);
  });
});
