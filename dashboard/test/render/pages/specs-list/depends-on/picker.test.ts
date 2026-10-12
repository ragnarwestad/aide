// The Depends on picker on the Running tab's open row: which specs it
// offers, which it ticks, which it keeps though archived or closed, and
// when the row draws none.

import { describe, expect, test } from "bun:test";
import type { ArchivedSpecView, QueueRowView, SpecsPageOptions, SpecTarget } from "../../../../../src/render";
import { groupBySpec } from "../../../../../src/render/pages/specs-list/data-model";
import { dependsOnFormId, dependsOnLine, dependsOnOffer } from "../../../../../src/render/pages/specs-list/depends-on";
import { row } from "../../fixtures.ts";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const FOLDER = "81-queue-x";
const spec = (specFolder: string, extra: Partial<SpecTarget> = {}): SpecTarget => ({ project: "aide", specFolder, ...extra });

/** The options the Running tab hands its rows: every active spec of every project, and the archived keys. */
const optionsFor = (targets: SpecTarget[], archived: string[] = []): SpecsPageOptions =>
  ({ runnerAvailable: true, targets, archived }) as SpecsPageOptions;

const groupOf = (targets: SpecTarget[], opts: SpecsPageOptions, jobs: QueueRowView[] = []) =>
  groupBySpec(jobs, targets, opts.archived, undefined, NOW).find((g) => g.specFolder === FOLDER)!;

const SIBLINGS = [spec("99-a-second-spec"), spec("88-a-third-spec")];
const boxes = (html: string): string[] =>
  [...html.matchAll(/<input [^>]*name="dependsOn"[^>]*value="([^"]+)"[^>]*>/g)].map((m) => m[1]!);
const tickedBoxes = (html: string): string[] =>
  [...html.matchAll(/<input [^>]*name="dependsOn"[^>]*value="([^"]+)"[^>]*>/g)].filter((m) => m[0].includes(" checked")).map((m) => m[1]!);

describe("what the picker offers", () => {
  test("is the project's active specs, not the spec itself, another project's or an archived one (AC-2)", () => {
    const targets = [spec(FOLDER), ...SIBLINGS, { project: "other", specFolder: "77-elsewhere" }];
    const opts = optionsFor(targets, ["aide/80-archived"]);
    expect(dependsOnOffer(groupOf(targets, opts), opts).options.map((t) => t.specFolder).sort()).toEqual([
      "88-a-third-spec",
      "99-a-second-spec",
    ]);
  });

  test("ticks what the spec depends on now (AC-1)", () => {
    const targets = [spec(FOLDER, { dependsOn: ["99-a-second-spec"] }), ...SIBLINGS];
    const opts = optionsFor(targets);
    expect(dependsOnOffer(groupOf(targets, opts), opts).ticked).toEqual(["99-a-second-spec"]);
  });

  test("keeps a dependency since archived or closed, and leaves out an entry nothing matches (AC-4)", () => {
    const targets = [spec(FOLDER, { dependsOn: ["80-archived", "140-a-closed-one", "99-a-second-spec", "55"] }), ...SIBLINGS];
    // A closed spec is among the archived keys, as the Running tab's options carry it.
    const opts = optionsFor(targets, ["aide/80-archived", "aide/140-a-closed-one"]);
    const offer = dependsOnOffer(groupOf(targets, opts), opts);
    expect(offer.locked).toEqual(["80-archived", "140-a-closed-one"]);
    expect(offer.options.map((t) => t.specFolder)).not.toContain("80-archived");
  });
});

describe("the line the open row draws", () => {
  test("is a form posting to the spec's tracking route, with the ticks and the archived dependency in it (AC-1, AC-4)", () => {
    const targets = [spec(FOLDER, { dependsOn: ["80-archived", "99-a-second-spec"] }), ...SIBLINGS];
    const opts = optionsFor(targets, ["aide/80-archived"]);
    const g = groupOf(targets, opts);
    const html = dependsOnLine(g, opts);
    expect(html).toContain(`action="/api/queue/specs/aide/${FOLDER}/tracking"`);
    expect(html).toContain(`id="${dependsOnFormId(g)}"`);
    expect(boxes(html).sort()).toEqual(["80-archived", "88-a-third-spec", "99-a-second-spec"]);
    expect(tickedBoxes(html).sort()).toEqual(["80-archived", "99-a-second-spec"]);
    expect(html).toContain(`id="${dependsOnFormId(g)}-cancel"`);
  });

  test("two specs' forms have ids of their own (AC-3)", () => {
    const targets = [spec(FOLDER), spec("82-other-spec")];
    const opts = optionsFor(targets);
    const [a, b] = groupBySpec([], targets, opts.archived, undefined, NOW);
    expect(dependsOnFormId(a!)).not.toBe(dependsOnFormId(b!));
  });

  test("is nothing for a spec that is archived or closed (AC-1)", () => {
    const targets = SIBLINGS;
    const opts = optionsFor(targets, [`aide/${FOLDER}`]);
    const record: ArchivedSpecView = { project: "aide", folder: FOLDER, done: ["create", "analyze", "implement", "archive"], models: {}, phaseOutcomes: {} };
    const g = groupBySpec([], targets, opts.archived, [record], NOW).find((x) => x.specFolder === FOLDER)!;
    expect(dependsOnLine({ ...g, dependsOn: ["99-a-second-spec"] }, opts)).toBe("");
  });

  test("is nothing for a create whose folder does not exist yet (AC-1)", () => {
    const create = row({ id: "c1", specFolder: "create-1", state: "running", steps: ["create"], stepIndex: 0 });
    const opts = optionsFor(SIBLINGS);
    const g = groupBySpec([create], SIBLINGS, opts.archived, undefined, NOW).find((x) => x.specFolder === "create-1")!;
    expect(g.named).toBe(false);
    expect(dependsOnLine(g, opts)).toBe("");
  });

  test("is nothing for a spec alone in its project that depends on nothing (AC-1)", () => {
    const targets = [spec(FOLDER)];
    const opts = optionsFor(targets);
    expect(dependsOnLine(groupOf(targets, opts), opts)).toBe("");
  });

  test("shows the ticks with every box disabled and no Save or Cancel while the lead job is queued or running (AC-1)", () => {
    const targets = [spec(FOLDER, { dependsOn: ["99-a-second-spec"] }), ...SIBLINGS];
    const opts = optionsFor(targets);
    for (const state of ["queued", "running"] as const) {
      const job = row({ id: `j-${state}`, specFolder: FOLDER, state, steps: ["analyze"], stepIndex: 0 });
      const html = dependsOnLine(groupOf(targets, opts, [job]), opts);
      expect(tickedBoxes(html)).toEqual(["99-a-second-spec"]);
      for (const tag of html.match(/<input [^>]*name="dependsOn"[^>]*value="[^"]+"[^>]*>/g)!) expect(tag).toContain(" disabled");
      expect(html).not.toContain("-cancel");
      expect(html).not.toContain("-save");
    }
  });

  test("is live while the lead job is landing (AC-1)", () => {
    const targets = [spec(FOLDER, { dependsOn: ["99-a-second-spec"] }), ...SIBLINGS];
    const opts = optionsFor(targets);
    const landing = row({ id: "j-land", specFolder: FOLDER, state: "done", landing: true, steps: ["implement"], stepIndex: 0 });
    const html = dependsOnLine(groupOf(targets, opts, [landing]), opts);
    for (const tag of html.match(/<input [^>]*name="dependsOn"[^>]*value="[^"]+"[^>]*>/g)!) expect(tag).not.toContain(" disabled");
    expect(html).toContain("-cancel");
  });
});
