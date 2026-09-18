import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type SpecTarget, type SpecsFilter } from "../../../../../src/render";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../../../src/project/parse-status";
import { row } from "../../fixtures.ts";

// --- spec 493: the acceptance criteria, unfolded on the row that names them --

const FOLDER = "493-tick-from-the-list";
const KEY = `aide/${FOLDER}`;
const ROW_OPEN = "| AC-1: it folds | ⬜ | still to judge |";
const ROW_DONE = "| AC-2: it saves | ✅ | |";
const ROW_OPEN_TWO = "| AC-3: it fits a phone | ⬜ | |";
const rows = [ROW_OPEN, ROW_DONE, ROW_OPEN_TWO].map((line) => {
  const cells = line.split("|").map((c) => c.trim());
  return { phase: "Acceptance criteria", line, task: cells[1]!, done: cells[2] === "✅", note: cells[3] };
});

const target = (extra: Partial<SpecTarget> = {}): SpecTarget => ({
  project: "aide",
  specFolder: FOLDER,
  done: ["analyze", "implement"],
  archiveHeldBack: { reason: ACCEPTANCE_CRITERIA_UNTICKED_NOTE },
  acceptanceOpen: true,
  acceptance: rows,
  ...extra,
});

const notice = (filter: SpecsFilter = {}, t: SpecTarget = target(), list = [row({ specFolder: FOLDER, steps: ["archive"], state: "done" })]) =>
  renderSpecsRows(list, { runnerAvailable: true, targets: [t], filter, token: "tok" })
    .match(/<tr class="specnotice"[^>]*>[\s\S]*?<\/tr>/)?.[0] ?? "";

const foldLink = (html: string) => html.match(/<a class="fold[^"]*"[^>]*aria-expanded[^>]*>/)?.[0] ?? "";

describe("the › beside the held-back message", () => {
  test("folded: a link with aria-expanded=false that adds the spec's key and keeps the rest of the view", () => {
    const html = notice({ open: KEY, sort: "cost", state: "all", project: "aide", q: "tick", checks: "aide/other" });
    const link = foldLink(html);
    expect(link).toContain('aria-expanded="false"');
    expect(link).toContain(`checks=${encodeURIComponent(`aide/other,${KEY}`)}`);
    for (const kept of ["open=", "sort=cost", "state=all", "project=aide", "q=tick"]) expect(link).toContain(kept);
    expect(html).not.toContain("AC-1: it folds");
  });

  test("unfolded: aria-expanded=true and an href that removes only that key", () => {
    const html = notice({ checks: `aide/other,${KEY}` });
    const link = foldLink(html);
    expect(link).toContain('aria-expanded="true"');
    expect(link).toContain(`checks=${encodeURIComponent("aide/other")}`);
    expect(link).not.toContain(encodeURIComponent(KEY));
  });

  test("the list sits directly under the held-back message, before the test server's", () => {
    const html = notice({ checks: KEY });
    const held = html.indexOf("Archive held back");
    const list = html.indexOf("AC-1: it folds");
    const server = html.indexOf("Test server");
    expect(held).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(held);
    expect(server).toBeGreaterThan(list);
  });

  test.each([
    ["every criterion ticked", target({ archiveHeldBack: undefined, acceptanceOpen: false, acceptance: undefined }), undefined],
    ["a round under way", target(), row({ specFolder: FOLDER, steps: ["analyze", "implement", "archive"], stepIndex: 1, state: "running" })],
  ])("%s: no › and no list, even with the key in the address", (_name, t, r) => {
    const html = notice({ checks: KEY }, t, r ? [r] : []);
    expect(html).not.toContain('class="fold');
    expect(html).not.toContain("rowchecks");
  });
});

describe("the unfolded list", () => {
  const html = notice({ checks: KEY });

  test("draws exactly the Acceptance rows, each verbatim, with its state and its note", () => {
    expect(html.match(/<li class="check /g)?.length).toBe(3);
    for (const line of [ROW_OPEN, ROW_DONE, ROW_OPEN_TWO]) {
      expect(html).toContain(`<input type="checkbox" name="tick" value="${line}"`);
    }
    expect(html).toMatch(/value="\| AC-2: it saves \| ✅ \| \|"[^>]*checked/);
    expect(html).not.toMatch(/value="\| AC-1: it folds[^>]*checked/);
    expect(html).toContain("still to judge");
  });

  test("posts to the tick route as a list press, with the section and the view", () => {
    expect(html).toContain(`action="/api/queue/specs/aide/${FOLDER}/tick?fromList=1"`);
    expect(html).toContain('name="checksPhase" value="Acceptance criteria"');
    expect(html).toContain(`name="view.checks" value="${KEY}"`);
    expect(html).toContain('name="token" value="tok"');
    expect(html).toContain('class="actionform rowchecks"');
  });

  test("a spec whose rows could not be read says so and links to the Checks tab, with no Save", () => {
    const bare = notice({ checks: KEY }, target({ acceptance: [] }));
    expect(bare).toContain("could not be read here");
    expect(bare).toContain(`/specs/aide/${FOLDER}?tab=checks`);
    expect(bare).not.toContain("rowchecks");
    expect(bare).not.toContain('name="tick"');
  });
});

describe("the held-back message and the test server's each stand on a line of their own", () => {
  test("two boxes, and no · between them", () => {
    const html = notice();
    expect(html.match(/class="rowmsg /g)?.length).toBe(2);
    expect(html).toContain("msgstack");
    expect(html).not.toContain(" · ");
  });

  test("with no test server available only the held-back box is drawn", () => {
    const html = renderSpecsRows([row({ specFolder: FOLDER, steps: ["archive"], state: "done" })], {
      runnerAvailable: true, targets: [target()], testServerAvailable: () => false,
    });
    expect(html.match(/class="rowmsg /g)?.length).toBe(1);
  });

  test("a failed push as well is a third box", () => {
    const html = notice({}, target(), [row({ specFolder: FOLDER, steps: ["archive"], state: "done", pushError: "rejected" })]);
    expect(html.match(/class="rowmsg /g)?.length).toBe(3);
  });

  test("a pull request beside them does not join the test server's box", () => {
    const html = notice({}, target(), [row({ specFolder: FOLDER, steps: ["archive"], state: "done", prUrl: "https://github.test/aide/pull/7" })]);
    expect(html.match(/class="rowmsg /g)?.length).toBe(3);
    expect(html).not.toContain(" · ");
  });

  test("a row with a failed push and a pull request and no hold is still one joined box", () => {
    const html = notice({}, target({ archiveHeldBack: undefined, acceptanceOpen: false, acceptance: undefined }), [
      row({ specFolder: FOLDER, steps: ["archive"], state: "done", pushError: "rejected", prUrl: "https://github.test/aide/pull/7" }),
    ]);
    expect(html.match(/class="rowmsg /g)?.length).toBe(1);
    expect(html).not.toContain("msgstack");
    expect(html).toContain(" · ");
    expect(html).toContain('href="https://github.test/aide/pull/7"');
  });
});
