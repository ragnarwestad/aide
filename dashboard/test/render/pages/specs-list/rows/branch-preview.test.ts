// The link a row carries to where its branch has been built by the host.
// It shows in the window the Test server link does: implement proven done,
// nothing running, archive not pressed — and only when the board holds an
// address for the spec.

import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type QueueRowView, type SpecTarget } from "../../../../../src/render";
import { row } from "../../fixtures.ts";

const FOLDER = "40-x";
const ADDRESS = "https://aide-40-x.woodstack.pages.dev";
const target = (extra: Partial<SpecTarget> = {}): SpecTarget => ({
  project: "woodstack",
  specFolder: FOLDER,
  historyDone: ["analyze", "implement"],
  ...extra,
});
const noticeCell = (html: string): string =>
  html.match(new RegExp(`<tr class="specnotice"[^>]*data-folder="${FOLDER}">[\\s\\S]*?</tr>`))?.[0] ?? "";
const render = (
  o: { rows?: QueueRowView[]; target?: SpecTarget; branchPreview?: (project: string, folder: string) => string | undefined } = {},
): string =>
  noticeCell(
    renderSpecsRows(o.rows ?? [], {
      runnerAvailable: true,
      targets: [o.target ?? target()],
      testServerAvailable: () => false,
      branchPreview: o.branchPreview ?? (() => ADDRESS),
    }),
  );

describe("a row's preview link", () => {
  test("implement done and an address kept: the notice links to the address (AC-1)", () => {
    expect(render()).toContain(`href="${ADDRESS}"`);
  });

  test("the address is asked about the spec's own project and folder (AC-1)", () => {
    const asked: string[] = [];
    render({ branchPreview: (project, folder) => {
        asked.push(`${project}/${folder}`);
        return ADDRESS;
      } });
    expect(asked).toContain(`woodstack/${FOLDER}`);
  });

  test("no implement in the history: no link (AC-5)", () => {
    expect(render({ target: target({ historyDone: ["analyze"] }) })).not.toContain(ADDRESS);
  });

  test("no address kept: no link (AC-4)", () => {
    expect(render({ branchPreview: () => undefined })).not.toContain("pages.dev");
  });

  test("a row drawn without the option carries no link (AC-4)", () => {
    const html = noticeCell(
      renderSpecsRows([], { runnerAvailable: true, targets: [target()], testServerAvailable: () => false }),
    );
    expect(html).not.toContain("pages.dev");
  });

  test("a running analyze, implement or archive, or a queued archive: no link, and it is back once they end (AC-2)", () => {
    const withJob = (steps: string[], stepIndex: number, state: QueueRowView["state"]) =>
      render({ rows: [row({ project: "woodstack", specFolder: FOLDER, steps, stepIndex, state })] });
    const steps = ["analyze", "implement", "archive"];
    expect(withJob(steps, 0, "running")).not.toContain(ADDRESS);
    expect(withJob(steps, 1, "running")).not.toContain(ADDRESS);
    expect(withJob(steps, 2, "running")).not.toContain(ADDRESS);
    expect(withJob(["archive"], 0, "queued")).not.toContain(ADDRESS);
    expect(render()).toContain(ADDRESS);
  });

  test("an archived row carries no link (AC-2)", () => {
    const html = noticeCell(
      renderSpecsRows([], {
        runnerAvailable: true,
        targets: [],
        archived: [`aide/${FOLDER}`],
        archivedSpecs: [
          { project: "woodstack", folder: FOLDER, done: ["create", "analyze", "implement", "archive"], models: {}, phaseOutcomes: {} },
        ],
        filter: { state: "archived" },
        branchPreview: () => ADDRESS,
      }),
    );
    expect(html).not.toContain(ADDRESS);
  });
});
