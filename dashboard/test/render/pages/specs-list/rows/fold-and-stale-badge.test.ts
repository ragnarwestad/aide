import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type ArchivedSpecView, type QueueRowView, type SpecsPageOptions, type SpecTarget } from "../../../../../src/render";
import { t } from "../../../../../src/i18n";
import { row, openKeys } from "../../fixtures.ts";

// Split out of grouping.test.ts by theme.

// Spec 97: the row says when the plan describes an older problem than
// the description does. Nothing is blocked — a person who knows the
// edit was cosmetic can still start `implement`; the page just stops
// pretending the plan is current.
describe("the description-changed badge (criteria 1, 3)", () => {
  const job = (id: string, step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({ id, specFolder: "97-stale", steps: [step], stepIndex: 0, state: "done", ...extra });

  const target = (specFolder: string, extra: Partial<SpecTarget> = {}): SpecTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  // The badge sits on the analyze PHASE LINE, which a collapsed row
  // does not draw at all — so every example here opens its spec.
  const rows = (list: QueueRowView[], targets: SpecTarget[]) =>
    renderSpecsRows(
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
    expect(subRow(html, "analyze")).toContain("Description changed since");
    for (const phase of ["implement", "archive"]) {
      expect(subRow(html, phase)).not.toContain("Description changed since");
    }
  });

  test("a spec nothing has run carries it too (criterion 1)", () => {
    const html = rows([], [target("97-never-run", { analyzeStale: true })]);
    expect(subRow(html, "analyze")).toContain("Description changed since");
  });

  test("a spec whose description has not moved carries nothing (criterion 4)", () => {
    const html = rows([job("j1", "analyze")], [target("97-stale")]);
    expect(html).not.toContain("Description changed since");
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
    // `implement` has run: its box can be ticked for another run, but a
    // press does not run it again unless the reader ticks it.
    expect(line).toMatch(/name="steps" value="implement"/);
    expect(line).not.toMatch(/value="implement" checked/);
    // `analyze` and `archive` are what is left to run, so both are
    // pre-ticked (spec 200); `create`'s box carries no field name.
    expect([...line.matchAll(/name="steps" value="[^"]*" checked/g)]).toHaveLength(2);
  });
});

// Spec 627: a row is opened by loading the spec's own address, so one row
// is open at a time and each chevron is a link to the page that shows it.
describe("the open row and the chevrons (AC-3)", () => {
  const targets: SpecTarget[] = [
    { project: "aide", specFolder: "81-queue-x" },
    { project: "aide", specFolder: "82-queue-y" },
  ];
  const html = renderSpecsRows(
    [],
    {
      runnerAvailable: true,
      targets,
      filter: { q: "queue" },
      openSpec: { key: "aide/81-queue-x", detail: "<p>THE-SPEC</p>" },
    },
    Date.parse("2026-08-18T12:00:00Z"),
  );
  const chevron = (folder: string): string =>
    html.match(new RegExp(`<tr class="spechead"[^>]*data-folder="${folder}">[\\s\\S]*?(<a class="fold[^"]*"[^>]*>)`))?.[1] ?? "";

  test("exactly one row is open, and it ends in the spec", () => {
    expect(html.match(/<a class="fold"[^>]*aria-expanded="true"/g)).toHaveLength(1);
    expect(html.match(/data-spec-detail="/g)).toHaveLength(1);
    expect(html).toContain('data-spec-detail="aide/81-queue-x"');
    expect(html).toContain("<p>THE-SPEC</p>");
  });

  test("a shut row's chevron loads the spec's address with the list's view, and is not a row swap", () => {
    const link = chevron("82-queue-y");
    expect(link).toContain('href="/specs/aide/82-queue-y?q=queue#spec-aide/82-queue-y"');
    expect(link).toContain("data-goto");
    expect(link).not.toContain("data-nav");
  });

  test("the open row's chevron leads back to the list, with the row's view", () => {
    expect(chevron("81-queue-x")).toContain('href="/specs?q=queue#spec-aide/81-queue-x"');
  });

  test("no spec is open when openSpec names no key", () => {
    const shut = renderSpecsRows([], { runnerAvailable: true, targets, openSpec: {} }, Date.parse("2026-08-18T12:00:00Z"));
    expect(shut.match(/aria-expanded="true"/g)).toBeNull();
    expect(shut).not.toContain("data-spec-detail");
  });
});

// What the Specs list's chevron opens is the spec; the Running tab's opens the phases.
describe("a shut row's chevron title", () => {
  const targets: SpecTarget[] = [{ project: "aide", specFolder: "82-queue-y" }];
  const folder = "82-queue-y";
  const action = t("en", "list.foldShow");
  const chevron = (opts: Partial<SpecsPageOptions>): string =>
    renderSpecsRows([], { runnerAvailable: true, targets, ...opts }, Date.parse("2026-08-18T12:00:00Z"))
      .match(new RegExp(`<tr class="spechead"[^>]*data-folder="${folder}">[\\s\\S]*?(<a class="fold[^"]*"[^>]*>)`))?.[1] ?? "";

  test("on the Specs list it names the spec", () => {
    expect(chevron({ openSpec: {} })).toContain(`title="${t("en", "list.specFoldTitle", { action, folder })}"`);
  });

  test("drawn the Running tab's way it keeps the phases title", () => {
    expect(chevron({ filter: {} })).toContain(`title="${t("en", "list.foldTitle", { action, folder })}"`);
  });
});

// Spec 629: the Specs list opens a row to the spec; what runs is on the
// Running tab, whose open row keeps the caption line and the phase lines.
describe("an open row on the Specs list is the spec alone (AC-1, AC-2, AC-3)", () => {
  const NOW = Date.parse("2026-08-18T12:00:00Z");
  const archived: ArchivedSpecView = {
    project: "aide",
    folder: "50-archived",
    done: ["create", "analyze", "implement", "archive"],
    models: {},
    phaseOutcomes: {},
  };
  const targets: SpecTarget[] = [
    { project: "aide", specFolder: "81-queue-x" },
    { project: "aide", specFolder: "82-queue-y" },
  ];
  const list = [row({ id: "run82", specFolder: "82-queue-y", state: "running" })];
  const base: SpecsPageOptions = {
    runnerAvailable: true,
    targets,
    archivedSpecs: [archived],
    modelChoices: [{ name: "sonnet" }, { name: "codex-fast", tool: "codex" }],
    phaseMessages: () => ({ logs: [{ by: "ai" as const, lines: [] }], running: false }),
  };
  const specs = ["aide/81-queue-x", "aide/82-queue-y", "aide/50-archived"];

  /** One spec's rows, from its title line to its gap row. */
  const group = (html: string, key: string): string =>
    html.match(new RegExp(`<tr class="spechead\\b[^>]*?\\bid="spec-${key}"[\\s\\S]*?<tr class="specgap"[^>]*>.*?</tr>`))?.[0] ?? "";
  const onList = (key: string): string =>
    group(
      renderSpecsRows(list, { ...base, filter: { phases: "aide/81-queue-x:create" }, openSpec: { key, detail: "<p>THE-SPEC</p>" } }, NOW),
      key,
    );
  const onJobsTab = (key: string): string =>
    group(renderSpecsRows(list, { ...base, filter: { open: key, phases: "aide/81-queue-x:create" } }, NOW), key);

  test("no caption line, phase line, message, select, Select box, Run, Cancel or row Reopen (AC-1)", () => {
    for (const key of specs) {
      const html = onList(key);
      expect(html).toContain("THE-SPEC");
      for (const absent of [
        "data-caption", "tr class=\"subrow", "data-step", "phasemsgs", "<select", "data-phase", 'name="steps"',
        'class="rowrun"', 'data-ask="cancelask-run82"', 'data-ask="reopenask-aide/50-archived"',
      ]) {
        expect([key, absent, html.includes(absent)]).toEqual([key, absent, false]);
      }
    }
  });

  test("the rows are the title line, the state line, the messages if any, the spec, then the gap (AC-2)", () => {
    for (const key of specs) {
      const classes = [...onList(key).matchAll(/<tr class="([a-z]+)\b/g)].map((m) => m[1]);
      expect(classes.filter((c) => c !== "specnotice")).toEqual(["spechead", "specstate", "specdetail", "specgap"]);
      expect(classes.indexOf("specdetail")).toBeGreaterThan(classes.lastIndexOf("specnotice"));
    }
  });

  test("the approach choice's form is on the shut row and the Running tab's open row, not the Specs list's open row (AC-1)", () => {
    const pending = [
      { letter: "A", title: "Hold", mark: "recommended" as const },
      { letter: "B", title: "End", mark: "real alternative" as const },
    ];
    const choosing: SpecTarget[] = [
      { project: "aide", specFolder: "81-queue-x", done: ["create", "analyze"], historyDone: ["create", "analyze"], approachChoice: pending },
    ];
    const draw = (extra: Partial<SpecsPageOptions>): string =>
      renderSpecsRows([], { runnerAvailable: true, targets: choosing, ...extra }, NOW);
    const key = "aide/81-queue-x";
    expect(draw({})).toContain("/approach");
    expect(draw({ filter: { open: key } })).toContain("/approach");
    expect(draw({ openSpec: { key, detail: "<p>THE-SPEC</p>" } })).not.toContain("/approach");
  });

  test("drawn the Running tab's way, an open row has its caption line and its phase lines (AC-3)", () => {
    for (const key of specs) {
      const html = onJobsTab(key);
      expect([key, html.includes("data-caption")]).toEqual([key, true]);
      expect([key, html.match(/<tr class="subrow[^>]*data-step="/g)?.length]).toEqual([key, 4]);
    }
    expect(onJobsTab("aide/81-queue-x")).toContain("phasemsgs");
  });
});
