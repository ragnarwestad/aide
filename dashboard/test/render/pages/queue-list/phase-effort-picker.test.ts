// Spec 364: an Effort choice beside the model choice on every phase
// line. Mirrors phase-model-picker.test.ts's own shape, on the
// deliberately narrower terms 3-solution.md sets out: a flat list (no
// `<optgroup>`, effort has no per-tool split), and a three-tier
// resolution (used -> pending -> unset) rather than model's four-tier
// one — there is no configured-default tier, and "nothing chosen" has
// to stay a real, reachable resting value (REQ-4).

import { describe, expect, test } from "bun:test";
import {
  renderQueueRows,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../src/render.ts";
import { row, openKeys } from "../fixtures.ts";

describe("spec 364: each phase line picks its own effort level", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const CHOICES = [{ name: "sonnet", budgetUsd: 3 }];

  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [target("364-effort")],
    opts: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        modelChoices: CHOICES,
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";

  // --- REQ-1 -------------------------------------------------------------

  test("REQ-1: every phase line carries an effort select offering the five levels plus unset", () => {
    const line = subRow(rows([]), "analyze");
    const select = line.match(/<select name="effort\.analyze"[^>]*>[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(select).not.toBe("");
    for (const level of ["low", "medium", "high", "xhigh", "max"]) {
      expect(select).toContain(`value="${level}"`);
    }
    expect(select).not.toContain('value="ultracode"');
    // Unset is the resting value: nothing recorded, nothing pending.
    expect(select).toMatch(/<option value=""[^>]*selected/);
  });

  test("no option label ever reads out ultracode, whatever else changes", () => {
    const html = rows([]);
    expect(html).not.toContain("ultracode");
  });

  // --- REQ-2: pending survives a reload ----------------------------------

  test("REQ-2: a phase with a recorded pending effort pre-fills from it", () => {
    const line = subRow(
      rows([], [target("364-effort")], {
        pendingEffort: { "aide/364-effort": { analyze: "high" } },
      }),
      "analyze",
    );
    expect(line).toMatch(/<option value="high"[^>]*selected/);
  });

  test("a phase with no recorded pick stays unset", () => {
    const line = subRow(
      rows([], [target("364-effort")], {
        pendingEffort: { "aide/364-effort": { implement: "high" } },
      }),
      "analyze",
    );
    expect(line).toMatch(/<option value=""[^>]*selected/);
  });

  // --- used outranks pending ----------------------------------------------

  test("a phase that has run pre-fills with what it actually ran at, over any pending pick", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "364-effort", steps: ["analyze"], stepIndex: 0, state: "done", effort: "max" })],
      [target("364-effort", { done: ["analyze"] })],
      { pendingEffort: { "aide/364-effort": { analyze: "high" } } },
    );
    const line = subRow(html, "analyze");
    expect(line).toMatch(/<option value="max"[^>]*selected/);
  });

  // --- locking follows the model select's own rule ------------------------

  test("a busy spec's effort pickers lock exactly as the model select does", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "364-effort", steps: ["implement"], stepIndex: 0, state: "running" })],
      [target("364-effort")],
    );
    const select = subRow(html, "analyze").match(/<select name="effort\.analyze"[^>]*>/)?.[0] ?? "";
    expect(select).toContain("disabled");
  });

  test("a settled spec's effort pickers are live again", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "364-effort", steps: ["implement"], stepIndex: 0, state: "done" })],
      [target("364-effort")],
    );
    const select = subRow(html, "analyze").match(/<select name="effort\.analyze"[^>]*>/)?.[0] ?? "";
    expect(select).not.toContain("disabled");
  });

  test("a collapsed row offers no effort picker", () => {
    const html = rows([], [target("364-effort")], { filter: {} });
    expect(html).not.toContain('name="effort.');
  });
});
