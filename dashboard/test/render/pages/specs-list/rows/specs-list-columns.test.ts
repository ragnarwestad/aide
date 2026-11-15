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
