import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type ArchivedSpecView, type QueueRowView, type SpecsPageOptions, type SpecTarget } from "../../../../../src/render";
import { t } from "../../../../../src/i18n";
import { row, openKeys } from "../../fixtures.ts";

// Split out of grouping.test.ts by theme.

// A description changed since the analysis takes analyze back
// from done. Nothing is blocked — a person who knows the edit was
// cosmetic can still start `implement`. The explanation itself is the
// analyze phase's log's to say (`phase-messages/explanations.test.ts`).
describe("a description changed since the analysis", () => {
  const job = (id: string, step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({ id, specFolder: "97-stale", steps: [step], stepIndex: 0, state: "done", ...extra });

  const target = (specFolder: string, extra: Partial<SpecTarget> = {}): SpecTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  // The run controls sit on the phase lines, which a collapsed row does
  // not draw at all — so every example here opens its spec.
  const rows = (list: QueueRowView[], targets: SpecTarget[]) =>
    renderSpecsRows(
      list,
      { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) } },
      Date.parse("2026-08-18T12:00:00Z"),
    );

  /** The line the phase boxes are on, under the header. */
  const runLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";

  // `done` is what the server has already stripped `analyze`
  // out of; the row's job is to pre-tick the first phase
  // that is left, which is analyze — not implement.
  test("analyze is pre-ticked again, not implement", () => {
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
    // pre-ticked; `create`'s box carries no field name.
    expect([...line.matchAll(/name="steps" value="[^"]*" checked/g)]).toHaveLength(2);
  });
});

// A row is opened by loading the spec's own address, so one row
// is open at a time and each chevron is a link to the page that shows it.
describe("the open row and the chevrons", () => {
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
      openSpec: { key: "aide/81-queue-x", detail: () => "<p>THE-SPEC</p>" },
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

  test("a spec's title on the Specs list leads nowhere; its project still links to the project", () => {
    expect(html).not.toContain('class="specpart" data-goto');
    expect(html).toContain('href="/projects/aide"');
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

// The Specs list opens a row to the spec; what runs is on the
// Running tab, whose open row keeps the caption line and the phase lines.
describe("an open row on the Specs list is the spec alone", () => {
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
    phaseMessages: () => ({ logs: [{ by: "ai" as const, lines: [] }], steps: [], running: false }),
  };
  const specs = ["aide/81-queue-x", "aide/82-queue-y", "aide/50-archived"];

  /** One spec's rows, from its title line to its gap row. */
  const group = (html: string, key: string): string =>
    html.match(new RegExp(`<tr class="spechead\\b[^>]*?\\bid="spec-${key}"[\\s\\S]*?<tr class="specgap"[^>]*>.*?</tr>`))?.[0] ?? "";
  const onList = (key: string): string =>
    group(
      renderSpecsRows(list, { ...base, filter: { phases: "aide/81-queue-x:create" }, openSpec: { key, detail: () => "<p>THE-SPEC</p>" } }, NOW),
      key,
    );
  const onJobsTab = (key: string): string =>
    group(renderSpecsRows(list, { ...base, filter: { open: key, phases: "aide/81-queue-x:create" } }, NOW), key);

  test("no caption line, phase line, message, select, Select box, Run, Cancel or row Reopen", () => {
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

  test("the rows are the title line, the state line, the messages if any, the spec, then the gap", () => {
    for (const key of specs) {
      const classes = [...onList(key).matchAll(/<tr class="([a-z]+)\b/g)].map((m) => m[1]);
      expect(classes.filter((c) => c !== "specnotice")).toEqual(["spechead", "specstate", "specdetail", "specgap"]);
      expect(classes.indexOf("specdetail")).toBeGreaterThan(classes.lastIndexOf("specnotice"));
    }
  });

  test("the approach choice's form is on the shut row and the Running tab's open row, not the Specs list's open row", () => {
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
    expect(draw({ openSpec: { key, detail: () => "<p>THE-SPEC</p>" } })).not.toContain("/approach");
  });

  test("the Depends on picker is on the Running tab's open row, not on a shut row or the Specs list's open row", () => {
    const withSiblings: SpecTarget[] = [
      { project: "aide", specFolder: "81-queue-x", dependsOn: ["82-queue-y"] },
      { project: "aide", specFolder: "82-queue-y" },
    ];
    const draw = (extra: Partial<SpecsPageOptions>): string =>
      renderSpecsRows([], { runnerAvailable: true, targets: withSiblings, ...extra }, NOW);
    const key = "aide/81-queue-x";
    expect(draw({})).not.toContain("dependsform");
    expect(draw({ filter: { open: key } })).toContain("dependsform");
    expect(draw({ openSpec: { key, detail: () => "<p>THE-SPEC</p>" } })).not.toContain("dependsform");
  });

  test("drawn the Running tab's way, an open row has its caption line and its phase lines", () => {
    for (const key of specs) {
      const html = onJobsTab(key);
      expect([key, html.includes("data-caption")]).toEqual([key, true]);
      expect([key, html.match(/<tr class="subrow[^>]*data-step="/g)?.length]).toEqual([key, 4]);
    }
    expect(onJobsTab("aide/81-queue-x")).toContain("phasemsgs");
  });
});
