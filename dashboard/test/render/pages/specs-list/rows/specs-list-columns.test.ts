import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type QueueRowView, type SpecTarget } from "../../../../../src/render";

const targets: SpecTarget[] = [
  { project: "aide", specFolder: "81-cheap", createdAt: "2026-10-05T10:00:00Z" },
  { project: "aide", specFolder: "82-dear", createdAt: "2026-10-01T10:00:00Z" },
];
const ran = (specFolder: string, spentUsd: number): QueueRowView => ({
  id: specFolder, project: "aide", specFolder, steps: ["analyze"], stepIndex: 0, state: "done",
  spentUsd, timeoutSec: 600, createdAt: "2026-10-06T10:00:00Z", results: [],
}) as QueueRowView;

describe("the Specs list's columns", () => {
  test("draws Created, Specification, State and Actions without totals (AC-1, AC-3)", () => {
    const html = renderSpecsRows([], { runnerAvailable: true, targets, openSpec: {} });
    const headings = [...html.matchAll(/<th[^>]*>(?:<a[^>]*>)?([^<]*)/g)].map((m) => m[1]).filter(Boolean);
    expect(headings).toEqual(["Created", "Specification", "State", "Actions"]);
    expect(html.match(/<col data-col=/g)?.length).toBe(5);
    expect(html).not.toContain('data-col="started"');
    expect(html).not.toContain('data-col="cost"');
  });

  test("falls back from removed Specs sorts while Jobs keeps them (AC-2)", () => {
    const rows = [ran("81-cheap", 1), ran("82-dear", 9)];
    const specs = renderSpecsRows(rows, {
      runnerAvailable: true, targets, openSpec: {}, filter: { sort: "cost", dir: "desc" },
    });
    const jobs = renderSpecsRows(rows, {
      runnerAvailable: true, targets, filter: { sort: "cost", dir: "desc" },
    });
    expect(specs.indexOf('data-folder="81-cheap"')).toBeLessThan(specs.indexOf('data-folder="82-dear"'));
    expect(specs).not.toContain("sort=cost");
    expect(jobs.indexOf('data-folder="82-dear"')).toBeLessThan(jobs.indexOf('data-folder="81-cheap"'));
    expect(jobs).toContain("sort=cost");
  });

  test("puts help and every action in Actions while State has no control (AC-4, AC-5, AC-7)", () => {
    const html = renderSpecsRows([ran("81-cheap", 1)], {
      runnerAvailable: true,
      targets,
      openSpec: {},
      pdfAvailable: true,
    });
    const state = html.match(/<td data-col="state">([\s\S]*?)<\/td>/)?.[1] ?? "";
    expect(state).not.toMatch(/<(?:form|button|a)\b/);
    const positions = ["What these buttons do", ">Run<", ">Close<", ">Update<", "data-pdf"].map((part) => html.indexOf(part));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe("each row's actions act on that row's spec", () => {
  const archived = (folder: string) => ({
    project: "aide", folder, title: folder, createdAt: "2026-08-01T09:00:00Z",
    done: ["create", "analyze", "implement", "archive"], models: {}, phaseOutcomes: {},
  });
  const html = renderSpecsRows([ran("81-cheap", 1), ran("82-dear", 9)], {
    runnerAvailable: true,
    targets,
    openSpec: {},
    archivedSpecs: [archived("50-old"), archived("51-older")],
    filter: { state: "all" },
  });
  /** The dialog a row's button with this label opens, for this spec. */
  const dialogFor = (folder: string, label: string): string => {
    const start = html.indexOf(`<tr class="specstate" data-folder="${folder}">`);
    const end = html.indexOf('<tr class="spechead"', start);
    const row = start < 0 ? "" : html.slice(start, end < 0 ? undefined : end);
    const id = row.match(new RegExp(`data-ask="([^"]+)"[^>]*>${label}</button>`))?.[1] ?? "";
    return html.match(new RegExp(`<dialog[^>]*id="${id}"[^>]*>[\\s\\S]*?</dialog>`))?.[0] ?? "";
  };

  test("no two elements share an id (AC-4)", () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  test("Close opens the dialog that closes its own row's spec (AC-4)", () => {
    for (const folder of ["81-cheap", "82-dear"]) {
      expect(dialogFor(folder, "Close")).toContain(`action="/api/queue/specs/aide/${folder}/close"`);
    }
  });

  test("Reopen opens the dialog that reopens its own row's spec (AC-4)", () => {
    for (const folder of ["50-old", "51-older"]) {
      expect(dialogFor(folder, "Reopen")).toContain(`name="specFolder" value="${folder}"`);
    }
  });
});

describe("what a row's Actions cell offers and where Update writes", () => {
  /** The Actions cell of this spec's row. */
  const cell = (html: string, folder: string): string => {
    const start = html.indexOf(`<tr class="specstate" data-folder="${folder}">`);
    const from = html.indexOf('<td data-col="actions">', start);
    const end = html.indexOf('<tr class="spechead"', from);
    return start < 0 || from < 0 ? "" : html.slice(from, end < 0 ? undefined : end);
  };

  test("a create job whose folder has not landed offers no Close, Update or PDF (AC-4)", () => {
    const create = { ...ran("new-abc123", 0), steps: ["create"], state: "running" } as QueueRowView;
    const actions = cell(renderSpecsRows([create], { runnerAvailable: true, targets, openSpec: {}, pdfAvailable: true }), "new-abc123");
    for (const absent of [">Close<", ">Update<", "data-pdf"]) expect([absent, actions.includes(absent)]).toEqual([absent, false]);
  });

  test("Update on a row that is not the open spec writes in lines that row draws (AC-4)", () => {
    const html = renderSpecsRows([ran("81-cheap", 1), ran("82-dear", 9)], {
      runnerAvailable: true, targets, openSpec: { key: "aide/82-dear", detail: () => "" },
    });
    const actions = cell(html, "81-cheap");
    const line = actions.match(/<form[^>]*data-line="([^"]+)"[^>]*data-note="([^"]+)"/) ?? actions.match(/<form[^>]*data-note="([^"]+)"[^>]*data-line="([^"]+)"/);
    expect(line).not.toBeNull();
    for (const id of [line![1], line![2]]) expect(actions).toContain(`id="${id}"`);
  });
});
