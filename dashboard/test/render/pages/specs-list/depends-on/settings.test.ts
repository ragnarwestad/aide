// The four settings a spec was created with, on the Running tab's open row
// under Depends on: shown as the spec has them, the three analyze reads
// posting with the row's form until analyze has run and while no job of
// the spec is queued or running, the AI formulation never.

import { describe, expect, test } from "bun:test";
import type { QueueRowView, SpecsPageOptions, SpecTarget } from "../../../../../src/render";
import { groupBySpec } from "../../../../../src/render/pages/specs-list/data-model";
import { dependsOnFormId, dependsOnLine } from "../../../../../src/render/pages/specs-list/depends-on";
import { row } from "../../fixtures.ts";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const FOLDER = "81-queue-x";
const CHOICES = { acceptanceRequired: false, aiFormulate: true, criteriaChecks: "warn", chooseApproach: true } as const;
const spec = (specFolder: string, extra: Partial<SpecTarget> = {}): SpecTarget => ({ project: "aide", specFolder, ...extra });
const optionsFor = (targets: SpecTarget[]): SpecsPageOptions => ({ runnerAvailable: true, targets, archived: [] }) as SpecsPageOptions;
const lineOf = (target: SpecTarget, jobs: QueueRowView[] = []): string => {
  const opts = optionsFor([target]);
  return dependsOnLine(groupBySpec(jobs, [target], [], undefined, NOW).find((g) => g.specFolder === FOLDER)!, opts);
};

/** The names the line's controls post under. */
const posted = (html: string): string[] =>
  [...html.matchAll(/<(?:input|select) [^>]*name="([^"]+)"/g)].map((m) => m[1]!).filter((n) => n !== "dependsOn");

describe("the settings under Depends on", () => {
  test("are the spec's own: acceptance cleared, the checks at warn, the approach chosen", () => {
    const html = lineOf(spec(FOLDER, { createChoices: CHOICES }));
    expect(html).toMatch(/name="acceptanceRequired"(?![^>]* checked)/);
    expect(html).toMatch(/<option value="warn" selected>/);
    expect(html).toMatch(/name="chooseApproach"[^>]* checked/);
  });

  test("post the three analyze reads, with the sentinel, before analyze has run and with no job of the spec", () => {
    expect(posted(lineOf(spec(FOLDER, { createChoices: CHOICES }))).sort()).toEqual(
      ["acceptanceRequired", "chooseApproach", "criteriaChecks", "settingsEditable"],
    );
  });

  test("post nothing once analyze has run", () => {
    expect(posted(lineOf(spec(FOLDER, { createChoices: CHOICES, done: ["create", "analyze"] })))).toEqual([]);
  });

  test("post nothing while a job of the spec is queued or running", () => {
    for (const state of ["queued", "running"] as const) {
      const job = row({ id: `j-${state}`, specFolder: FOLDER, state, steps: ["analyze"], stepIndex: 0 });
      expect(posted(lineOf(spec(FOLDER, { createChoices: CHOICES }), [job]))).toEqual([]);
    }
  });

  test("never post the AI formulation, which create has already used", () => {
    expect(lineOf(spec(FOLDER, { createChoices: CHOICES }))).not.toContain('name="aiFormulateAcceptance"');
  });

  test("are tied to the row's own form, so two open rows do not share a control", () => {
    const html = lineOf(spec(FOLDER, { createChoices: CHOICES }));
    const id = dependsOnFormId({ project: "aide", specFolder: FOLDER });
    expect(html).toContain(`<select name="criteriaChecks" form="${id}" id="${id}-criteria-checks">`);
  });
});
