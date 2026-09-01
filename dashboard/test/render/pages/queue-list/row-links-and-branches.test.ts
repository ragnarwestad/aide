import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderQueueRows,
  type JobDetailView,
  type QueueRowView,
} from "../../../../src/render.ts";
import { NAV, detail, row } from "../fixtures.ts";

// Split out of grouping.test.ts by theme.

// Criterion 12: the row a reader actually watches is the way in.
//
// Spec 150 changed WHERE in: the name opens the SPEC, not whichever job
// happened to run last — so every spec has somewhere to point, including
// one that has never run anything.
describe("the queue row links to the spec (criterion 12)", () => {
  const SPEC_HREF = "/specs/aide/81-queue-and-runner";

  test("the spec cell links to the spec page", () => {
    const html = renderQueueRows([row()], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
    });
    // The project leads the name since 2026-08-21: a folder number is
    // only unique within its project, and the line under the name — where
    // the project used to sit — now carries what nothing else says.
    expect(html).toContain(
      `<a class="label" data-goto href="${SPEC_HREF}" title="aide:81-queue-and-runner">`+
        `<span class="muted">aide:</span>81-queue-and-runner</a>`,
    );
  });

  // "A spec that has never run has no job page to point at, so the name
  // is text: a link to nothing is worse than no link." That sentence is
  // what the spec page invalidates.
  test("a spec that has never run is a link too", () => {
    const html = renderQueueRows([], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
    });
    expect(html).toContain(`href="${SPEC_HREF}"`);
    expect(html).not.toContain('<span class="label" title="81-queue-and-runner">');
  });

  // Spec 237: a phase line no longer leaves the spec. It opens the tab
  // that shows what that phase MADE — analyze's is 3-solution.md — on
  // the spec page the reader is already looking at.
  test("the phase lines point at the tab their phase wrote", () => {
    const html = renderQueueRows([row({ steps: ["analyze"], state: "done" })], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      filter: { open: "aide/81-queue-and-runner" },
    });
    expect(html).toContain(`href="${SPEC_HREF}?tab=solution"`);
    expect(html).not.toContain('href="/specs/job-1234"');
  });

  // The name clamps to two lines with an ellipsis, and the marks carry
  // a lead-in (reworked 2026-08-26 from a one-line clamp that hid most
  // of a long folder name behind a click).
  test("the marks say what they are, and the stylesheet clamps the name", async () => {
    const html = renderQueueRows(
      [row({ branchUrls: [{ label: "aide", url: "https://example.test/compare" }] })],
      { runnerAvailable: true, targets: [] },
    );
    expect(html).toContain('<span class="branchlist"><span class="lbl">Repos:</span>');
    // Spec 161: "Affected" said nothing — a repo listed on a spec's row
    // is affected by it, which is why it is listed.
    expect(html).not.toContain("Affected repos");
    const { CSS } = await import("../../../../src/render/ui/css.ts");
    expect(CSS).toContain(".spec-name > .label { overflow: hidden;");
    expect(CSS).toContain("-webkit-line-clamp: 2;");
  });

  test("an existing branch link stays beside it, never replaced by it", () => {
    const html = renderQueueRows(
      [row({ branchUrls: [{ label: "aide", url: "https://example.test/compare" }] })],
      {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      },
    );
    expect(html).toContain(
      '<a class="label" data-goto href="/specs/aide/81-queue-and-runner" title="aide:81-queue-and-runner">' +
        '<span class="muted">aide:</span>81-queue-and-runner</a>',
    );
    expect(html).toContain('href="https://example.test/compare"');
  });

  // Spec 307: a create job's spec has no folder yet, so `named` is
  // false — the row has nothing real to link to.
  test("an un-landed create job names its row by the form's title, drawn as text, not a link", () => {
    const html = renderQueueRows([row({ steps: ["create"], createTitle: "My new idea" })], {
      runnerAvailable: true,
      targets: [],
    });
    expect(html).toContain('<span class="label">My new idea</span>');
    expect(html).not.toContain("data-goto");
  });

  // REQ-4: the name carries the title now, so the line under it must
  // not say it again.
  test("the un-landed row's title appears once, not repeated under the name", () => {
    const html = renderQueueRows([row({ steps: ["create"], createTitle: "My new idea" })], {
      runnerAvailable: true,
      targets: [],
    });
    expect(html.match(/My new idea/g)).toHaveLength(1);
    expect(html).not.toContain('<div class="spec-title">My new idea</div>');
  });
});
// --- spec 04: a finished job does not say its work is unmerged ---------------

// Criteria 1-4: the branch link alone says where the work IS, never
// whether it landed. A reader who sees only the link reads a finished
// job as a delivered one.
//
// The repo list is about WHERE the work is. It carried a mark beside
// every unlanded branch — "waiting for archive", once per repo — until
// nobody could say who had asked for it: the State column says what the
// spec waits for, and a two-repo row said it three times. The rule that
// replaces four specs' worth of wording is a flat one, asserted below:
// links, and nothing else.
describe("the repo list says where the work is, and nothing more", () => {
  const BRANCH = "https://example.test/compare";
  // Spec 89: one entry per repo. A one-repo spec is a list of one,
  // through the same code a two-repo spec uses.
  const at = () => [{ label: "aide", url: BRANCH }];
  const queueRows = (extra: Partial<QueueRowView>) =>
    renderQueueRows([row(extra)], { runnerAvailable: true, targets: [] });
  /** The repo list and NOTHING after it: it sits in the name cell,
   *  which the State cell follows — so a slice to the end of the row
   *  would carry the very chip these tests prove it does not repeat. */
  const branchArea = (html: string): string => {
    const from = html.slice(html.indexOf('class="branchlist"'));
    return from.slice(0, from.indexOf("</td>"));
  };

  // The whole point: no badge, in any job state, landed or not.
  test.each(["running", "queued", "done", "failed", "stopped"] as const)(
    "a %s job's repo list carries no state of any kind",
    (state) => {
      const html = queueRows({ branchUrls: at(), state });
      expect(html).not.toContain("waiting for archive");
      expect(branchArea(html)).not.toContain('class="badge');
      // The link a reader actually uses is untouched.
      expect(html).toContain(`href="${BRANCH}"`);
    },
  );

  // The verb was never the problem — saying it a second and third time
  // was. It must go on being said ONCE, in the State column.
  test.each([
    ["create", "creating"],
    ["analyze", "analyzing"],
    ["implement", "implementing"],
    ["archive", "archiving"],
  ])("a %s job still says %s in the State column, and never in the repo list", (step, running) => {
    for (const state of ["running", "queued"] as const) {
      const html = queueRows({ branchUrls: at(), state, steps: [step], stepIndex: 0 });
      expect(html).toContain(state === "running" ? `>${running}<` : `>${running} queued<`);
      expect(branchArea(html)).not.toContain(running);
    }
  });

  // Spec 89: the two branches share a NAME and nothing else, so each
  // gets its own link. That survives; only the mark beside it went.
  test("two repos get two links", () => {
    const html = queueRows({
      state: "done",
      branchUrls: [
        { label: "aide", url: "https://example.test/aide" },
        { label: "aide-specs", url: "https://example.test/aide-specs" },
      ],
    });
    expect(html).toContain("https://example.test/aide-specs");
    expect(html).toContain("aide-specs");
    expect(html).not.toContain("waiting for archive");
  });

  // Spec 150 took the Work line off the job page; the row carries the
  // branch. Neither page may bring the mark back.
  test("the job page carries no branch and no mark (spec 150)", () => {
    for (const state of ["running", "done"] as const) {
      const html = renderJobDetailPage(
        detail({ branchUrls: at(), state }),
        "2026-08-17T10:00:00Z",
        NAV,
        { tab: "overview" },
      );
      expect(html).not.toContain(BRANCH);
      expect(html).not.toContain("waiting for archive");
    }
  });
});
// --- spec 95: where the branch can be TRIED ----------------------------------

// The compare link says where the work is; for a web app the link that
// matters more is "try it". A project whose host builds every branch has
// one address per branch, and until now a reader had to know the host's
// naming rule and paste it together by hand.
describe("the preview link beside the compare link (criteria 1-4)", () => {
  const PREVIEW = "https://aide-95-preview.example.pages.dev";
  const queueRows = (extra: Partial<QueueRowView>) =>
    renderQueueRows([row(extra)], { runnerAvailable: true, targets: [] });
  const jobPage = (extra: Partial<JobDetailView>) =>
    renderJobDetailPage(detail(extra), "2026-08-17T10:00:00Z", NAV, { tab: "overview" });
  const withPreview = [
    { label: "aide", url: "https://example.test/aide", previewUrl: PREVIEW },
  ];

  test("the row shows it next to the compare link, never instead of it (criterion 1)", () => {
    const html = queueRows({ branchUrls: withPreview, state: "done" });
    expect(html).toContain(`href="${PREVIEW}"`);
    expect(html).toContain('href="https://example.test/aide"');
    expect(html).toContain(">preview</a>");
  });

  // Spec 150 took the Work line off the job page; the row is where both
  // links live now.
  test("the job page shows neither link — the row carries both (spec 150)", () => {
    const html = jobPage({ branchUrls: withPreview, state: "done" });
    expect(html).not.toContain(PREVIEW);
    expect(html).not.toContain('href="https://example.test/aide"');
  });

  // A project with no `deployment.preview` — aide itself, PaceUp — must
  // render exactly as it did before this field existed.
  test("no previewUrl, nothing new on either page (criterion 3)", () => {
    const bare = [{ label: "aide", url: "https://example.test/aide" }];
    const html = queueRows({ branchUrls: bare });
    expect(html).not.toContain(">preview</a>");
    expect(html).toContain('href="https://example.test/aide"');
  });

  // The specs repo holds a plan. There is nothing to try in it, whatever
  // the project's manifest says.
  test("only the repo that carries the preview link gets one (criterion 4)", () => {
    const html = queueRows({
      state: "done",
      branchUrls: [
        { label: "aide", url: "https://example.test/aide", previewUrl: PREVIEW },
        { label: "aide-specs", url: "https://example.test/aide-specs" },
      ],
    });
    expect(html.match(/>preview<\/a>/g)).toHaveLength(1);
  });
});
