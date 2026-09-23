import { describe, expect, test } from "bun:test";
import { renderSpecsRows } from "../../../../../src/render";
import { row } from "../../fixtures.ts";

// Split out of grouping.test.ts by theme.

// Criterion 12: the row a reader actually watches is the way in.
//
// Spec 150 changed WHERE in: the name opens the SPEC, not whichever job
// happened to run last — so every spec has somewhere to point, including
// one that has never run anything.
describe("the queue row links to the spec (criterion 12)", () => {
  const SPEC_HREF = "/specs/aide/81-queue-and-runner";

  test("the spec cell links to the spec page", () => {
    const html = renderSpecsRows([row()], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
    });
    // The project leads the name since 2026-08-21: a folder number is
    // only unique within its project, and the line under the name — where
    // the project used to sit — now carries what nothing else says.
    // Project, then the spec's NUMBER and its title. The slug is left
    // to the href: it says the title over again in hyphens.
    expect(html).toContain(
      `<span class="label"><a class="muted" data-goto href="/projects/aide">aide</a>` +
        `<a class="specpart" data-goto href="${SPEC_HREF}" title="aide:81-queue-and-runner">` +
        `<span class="muted">:</span><span class="specname">81-`,
    );
    expect(html).toContain(`href="${SPEC_HREF}"`);
  });

  // "A spec that has never run has no job page to point at, so the name
  // is text: a link to nothing is worse than no link." That sentence is
  // what the spec page invalidates.
  test("a spec that has never run is a link too", () => {
    const html = renderSpecsRows([], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
    });
    expect(html).toContain(`href="${SPEC_HREF}"`);
  });

  // Spec 451: a phase line's name is plain text — the spec page, with
  // all its tabs, is reached from the row's own header line instead.
  test("a phase line's name carries no link of its own", () => {
    const html = renderSpecsRows([row({ steps: ["analyze"], state: "done" })], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      filter: { open: "aide/81-queue-and-runner" },
    });
    expect(html).toContain('<span class="phasefold">Analyze</span>');
    expect(html).not.toContain(`href="${SPEC_HREF}?tab=solution"`);
    expect(html).not.toContain('href="/specs/job-1234"');
  });

  // The name clamps to two lines with an ellipsis (reworked 2026-08-26
  // from a one-line clamp that hid most of a long folder name behind a
  // click).
  test("the stylesheet clamps the name", async () => {
    const { CSS } = await import("../../../../../src/render/ui/css");
    expect(CSS).toContain(".spec-name > .label > .specpart > .specname { overflow: hidden;");
    expect(CSS).toContain("-webkit-line-clamp: 2;");
  });

  // Spec 307: a create job's spec has no folder yet, so `named` is
  // false — the row has nothing real to link to.
  test("an un-landed create job names its row by the form's title, drawn as text, not a link", () => {
    const html = renderSpecsRows([row({ steps: ["create"], createTitle: "My new idea" })], {
      runnerAvailable: true,
      targets: [],
    });
    // The project is on this row from the first moment too, the same
    // shape every landed row has — only the link is missing, because
    // there is no page to open yet.
    expect(html).toContain(
      '<span class="label"><a class="muted" data-goto href="/projects/aide">aide</a>' +
        '<span class="specpart"><span class="muted">:</span><span class="specname">My new idea</span></span></span>',
    );
    // Only the project links: there is no spec page to open yet.
    expect(html).not.toContain('href="/specs/');
  });

  // REQ-4: the name carries the title now, so the line under it must
  // not say it again.
  test("the un-landed row's title appears once, not repeated under the name", () => {
    const html = renderSpecsRows([row({ steps: ["create"], createTitle: "My new idea" })], {
      runnerAvailable: true,
      targets: [],
    });
    expect(html.match(/My new idea/g)).toHaveLength(1);
    expect(html).not.toContain('<div class="spec-title">My new idea</div>');
  });

  // The project is what makes a create row the same shape as every
  // other row on the list. It is known from the first moment — the
  // form asked for it — so nothing justifies leaving it off until the
  // folder lands.
  test("the project is named on a create row and on a landed one alike", () => {
    const creating = renderSpecsRows([row({ steps: ["create"], createTitle: "My new idea" })], {
      runnerAvailable: true,
      targets: [],
    });
    const landed = renderSpecsRows([row({ steps: ["analyze"] })], { runnerAvailable: true, targets: [] });
    for (const html of [creating, landed]) {
      expect(html).toContain('<a class="muted" data-goto href="/projects/aide">aide</a>');
    }
  });
});

// The name is two anchors side by side, the project's and the spec's
// (AC-2), and reads the same as before with its tags removed (AC-3).
describe("the row's name is two links", () => {
  const strip = (html: string): string => html.replace(/<[^>]*>/g, "");
  const label = (html: string): string => /<span class="label">.*?<\/span><\/a><\/span>/s.exec(html)![0];
  const targets = [{ project: "aide", specFolder: "81-queue-and-runner" }];

  test("a live row: no anchor holds another, and no whitespace stands between the halves (AC-2, AC-3)", () => {
    const name = label(renderSpecsRows([row()], { runnerAvailable: true, targets }));
    expect(name.match(/<a /g)).toHaveLength(2);
    expect(name).not.toMatch(/<a [^>]*>(?:(?!<\/a>).)*<a /s);
    expect(name).toContain("</a><a ");
    expect(name.match(/data-goto/g)).toHaveLength(2);
    expect(strip(name)).toMatch(/^aide:81-/);
  });

  test("an archived row has the same two anchors (AC-2)", () => {
    const html = renderSpecsRows([], {
      runnerAvailable: true,
      targets: [],
      archivedSpecs: [
        {
          project: "aide", folder: "81-queue-and-runner", title: "Queue and runner", description: "",
          createdAt: "2026-08-01T09:00:00Z", done: ["create", "analyze", "implement", "archive"],
          models: {}, phaseOutcomes: {},
        },
      ],
    });
    expect(html).toContain('<a class="muted" data-goto href="/projects/aide">aide</a><a class="specpart" data-goto href="/specs/aide/81-queue-and-runner"');
  });

  test("the list search still matches aide:81, and the tooltip is the identifier (AC-3)", () => {
    const html = renderSpecsRows([row()], { runnerAvailable: true, targets });
    expect(html).toContain('title="aide:81-queue-and-runner"');
    expect(strip(label(html))).toContain("aide:81");
  });
});
