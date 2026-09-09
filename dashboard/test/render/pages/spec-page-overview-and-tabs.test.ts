// Split out of spec-page.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { type JobDetailView } from "../../../src/render.ts";
import { file, lead, page, view } from "./spec-page-fixtures.ts";

// --- spec 212, criteria 1-3: one tab per document ---------------------------
//
// Four documents stacked on one tab is thousands of lines of
// preformatted text before the reader reaches whatever they came for.
// One tab each, and Checks (Overview until spec 294 renamed it and made
// Description the front page instead) carries no file text at all.

describe("spec 212: one tab per document, and Checks is none of them", () => {
  test("no document's text is stacked on the Checks tab", () => {
    const html = page(view(), "checks");
    expect(html).not.toContain('class="specfile"');
    expect(html).not.toContain("The dashboard never shows a spec.");
    expect(html).not.toContain("Approach 1.");
  });

  // Spec 294: the phase-status chip is gone from the banner entirely —
  // no badge, no state word, on any tab. The Update button stays. The
  // title line that used to stay with it is gone too, for the reason
  // the next test carries.
  test("no chip/badge shows a state, but the Update button is still there", () => {
    const html = page();
    expect(html).not.toContain('class="chip"');
    expect(html).not.toContain("not started");
    expect(html).toContain("Update");
  });

  // Spec 301's REQ-5 put a "Title:" label in front of the title, so a
  // reader meeting the page for the first time would not have to work
  // out from position alone that the bold sentence was the title. That
  // is reversed: the folder name sits directly above and IS the title,
  // lowercased and hyphenated, so the label answered a question its own
  // neighbour already answers — and the page said one name three ways.
  // The document's own heading below stays: it is the file's text.
  test("the banner carries no labelled title", () => {
    const html = page();
    expect(html).not.toContain('<span class="label">Title:</span>');
    // The spec is still named on the page, by the identifier every other
    // surface uses for it — the branch, the commit subjects, the gate log.
    expect(html).toContain("150-one-page-shows-the-whole-spec");
  });

  test("every document is offered as a tab of its own", () => {
    const html = page();
    const base = "/specs/aide/150-one-page-shows-the-whole-spec";
    for (const tab of ["checks", "description", "analysis", "solution", "status", "steps"]) {
      expect([tab, html.includes(`href="${base}?tab=${tab}"`)]).toEqual([tab, true]);
    }
  });

  // Spec 296: the spec folder title sits beside ← Back, on one line,
  // rather than in `pageShell()`'s own separate heading above it.
  // Spec 404 (REQ-5): the project leads the folder, matching the
  // `<project>:<folder>` identifier every other surface already uses.
  test("the title sits inside .backhead, right after ← Back, and appears as <h1> exactly once", () => {
    const html = page();
    expect(html).toContain(
      '<div class="backhead"><a class="backlink" href="/">← Back</a><h1>aide:150-one-page-shows-the-whole-spec</h1></div>',
    );
    expect(html.match(/<h1>aide:150-one-page-shows-the-whole-spec<\/h1>/g)?.length ?? 0).toBe(1);
  });

  // REQ-5, REQ-6: the format is read off `view.project`, not hardcoded
  // to the fixture's own default of "aide".
  test("the title's project comes from the view, not a hardcoded default", () => {
    const html = page(view({ project: "atlasaurus" }));
    expect(html).toContain("<h1>atlasaurus:150-one-page-shows-the-whole-spec</h1>");
  });

  // Spec 295: Checks used to sit right after Solution; it belongs
  // between Status and Logs (the "steps" tab's own label) instead.
  test("Checks sits between Status and Logs in the tab row", () => {
    const html = page();
    const base = "/specs/aide/150-one-page-shows-the-whole-spec";
    const statusIdx = html.indexOf(`href="${base}?tab=status"`);
    const checksIdx = html.indexOf(`href="${base}?tab=checks"`);
    const stepsIdx = html.indexOf(`href="${base}?tab=steps"`);
    expect(statusIdx).toBeLessThan(checksIdx);
    expect(checksIdx).toBeLessThan(stepsIdx);
  });
});

describe("spec 212: each document tab shows its own file and no other", () => {
  const only = (tab: string, present: string, absent: string[]) => {
    const html = page(view(), tab);
    expect(html).toContain(present);
    for (const other of absent) expect([tab, other, html.includes(other)]).toEqual([tab, other, false]);
  };

  test("the analysis tab is the analysis alone", () => {
    only("analysis", "`discover.ts` has specTitle().", [
      "The dashboard never shows a spec.",
      "Approach 1.",
      "Phase 1: RED",
    ]);
  });

  test("the solution tab is the solution alone", () => {
    only("solution", "Approach 1.", [
      "The dashboard never shows a spec.",
      "`discover.ts` has specTitle().",
      "Phase 1: RED",
    ]);
  });

  test("the status tab is the status alone", () => {
    only("status", "Phase 1: RED", [
      "The dashboard never shows a spec.",
      "`discover.ts` has specTitle().",
      "Approach 1.",
    ]);
  });

  test("each carries the commit that last changed it, so the version is readable", () => {
    for (const tab of ["analysis", "solution", "status"]) {
      const html = page(view(), tab);
      expect([tab, html.includes("a3f9c21")]).toEqual([tab, true]);
      expect([tab, html.includes("2026-08-21T09:14:00+02:00")]).toEqual([tab, true]);
    }
  });

  // REQ-1: the two the analyze step writes are editable too — the same
  // editor, Save and hidden `file`/`baseSha` fields the Description tab
  // already has (spec 310). They are known, accepted overwrite targets:
  // a hand edit stands until the step that wrote the file next runs
  // (2-analysis.md, Codebase analysis), and they are the two files
  // implement reads, so a correction there is one that takes effect.
  //
  // `4-status.md` is not one of them: it is the run's own record, and
  // the acceptance checks in it belong to the Checks tab.
  test("the two the steps write carry a textarea, a file field, and no separate Edit link", () => {
    for (const [tab, file] of [
      ["analysis", "2-analysis.md"],
      ["solution", "3-solution.md"],
    ] as const) {
      const html = page(view(), tab);
      expect([tab, html.includes("<textarea")]).toEqual([tab, true]);
      expect([tab, html.includes(`name="file" value="${file}"`)]).toEqual([tab, true]);
      expect([tab, html.includes("/edit")]).toEqual([tab, false]);
    }
  });

  test("the Status tab carries no textarea and no file field", () => {
    const html = page(view(), "status");
    expect(html).toContain("4-status.md");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('name="file" value="4-status.md"');
  });

  // REQ-6: a spec with a job queued or running draws no Save form on
  // any of the four document tabs — the read-only shape instead,
  // mirroring the Checks tab's own `canTick` gate.
  test("a job in flight leaves every document tab read-only", () => {
    const withJob = view({ lead: lead({ state: "running" }) });
    for (const tab of ["description", "analysis", "solution", "status"]) {
      const html = page(withJob, tab);
      expect([tab, html.includes("<textarea")]).toEqual([tab, false]);
      expect([tab, html.includes('name="file"')]).toEqual([tab, false]);
    }
  });

  test("a file git cannot date is still shown — the content is the point", () => {
    const html = page(
      view({
        files: [file("2-analysis.md", "prose", { sha: undefined, at: undefined })],
      }),
      "analysis",
    );
    expect(html).toContain("prose");
    expect(html).not.toContain("undefined");
  });

  // A spec halfway through the workflow has files that are not written
  // yet. Saying so is the answer; an empty box is not.
  test("a file that has not been written says so, rather than showing nothing", () => {
    const html = page(view({ files: [file("2-analysis.md", null)] }), "analysis");
    expect(html).toContain("2-analysis.md");
    expect(html).toContain("has not been written yet");
  });

  // A tab whose file the view does not carry at all — an archived spec
  // read out of a folder missing one — must not render "undefined".
  test("a tab whose file is not among the view's renders the missing note", () => {
    const html = page(view({ files: [file("1-description.md", "prose")] }), "solution");
    expect(html).toContain("3-solution.md");
    expect(html).not.toContain("undefined");
  });

  // Markdown is NOT rendered (the description put that out of scope) —
  // which makes escaping the whole question: a spec file is arbitrary
  // text off disk, and it is full of angle brackets.
  test("a file's text is escaped, never markup", () => {
    const html = page(view({ files: [file("2-analysis.md", "`<script>alert(1)</script>`")] }), "analysis");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)");
  });
});

// --- spec 212, criteria 4, 5: the reload is scoped to the two tabs that move -
//
// The page reloaded itself every ten seconds on every tab, which is
// precisely why editing lived on a page of its own. Overview and the
// four document tabs now carry forms, so they stop reloading; Activity
// and Steps keep it, because they are the two that move while a step
// runs and neither holds a form.

describe("spec 212: which tabs reload themselves", () => {
  for (const tab of ["checks", "description", "analysis", "solution", "status"]) {
    test(`${tab} does not refresh itself under the reader`, () => {
      expect([tab, page(view(), tab).includes('http-equiv="refresh"')]).toEqual([tab, false]);
    });
  }

  for (const tab of ["steps"]) {
    test(`${tab} still reloads every ten seconds`, () => {
      expect(page(view(), tab)).toContain('<meta http-equiv="refresh" content="10">');
    });
  }

  // A tab name nobody offers falls back to Description (spec 294 — the
  // new default), and the fallback decides the reload too — not the raw
  // string off the query.
  test("a tab name nobody offers falls back to Description, reload and all", () => {
    expect(page(view(), "../secrets")).not.toContain('http-equiv="refresh"');
  });
});

// --- criterion 2: a spec that has never run ---------------------------------

describe("a spec with no job at all", () => {
  test("renders, and the Description tab is reachable", () => {
    const html = page();
    expect(html).toContain("Update");
    expect(page(view(), "description")).toContain("The dashboard never shows a spec.");
  });

  test("its Steps tab says what an empty job's tab says", () => {
    expect(page(view(), "steps")).toContain("No step has finished yet");
  });

  test("its tabs are offered all the same — an empty tab is still a tab", () => {
    const html = page();
    const base = "/specs/aide/150-one-page-shows-the-whole-spec";
    for (const tab of ["checks", "description", "steps"]) {
      expect(html).toContain(`href="${base}?tab=${tab}"`);
    }
  });
});

describe("a spec with a lead job", () => {
  const withLead = (extra: Partial<JobDetailView> = {}) => view({ lead: lead(extra) });

  test("the Steps tab's running row is the lead job's, word for word", () => {
    const html = page(withLead({ runningStep: { step: "analyze", logs: ["Bash ls"] } }), "steps");
    expect(html).toContain("Bash ls");
  });

  test("the Steps tab is the lead job's, word for word", () => {
    const results = [
      {
        step: "analyze", ok: true, costUsd: 0.42, costMeasured: true,
        terminalReason: "completed", at: "2026-08-21T09:01:00Z",
      },
    ];
    const html = page(view({ lead: lead({ results }), steps: results }), "steps");
    expect(html).toContain("$0.42");
  });

  test("the tab counts come from the lead job when nothing is selected, so a reader knows before clicking", () => {
    const html = page(withLead({ runningStep: { step: "analyze", logs: ["Bash ls"] } }));
    expect(html).toMatch(/>Logs \(1\)</);
  });

  // The page is about the SPEC, so it opens on the Description tab —
  // even while a step is running. The job page keeps its own rule (a
  // running job opens on the steps tab), because that page is about the
  // run.
  test("it opens on the Description tab, running or not", () => {
    const html = page(withLead({ state: "running" }));
    expect(html).toMatch(/aria-current="page"[^>]*>Description/);
  });
});

// --- criteria 3, 4: the Update button ---------------------------------------

describe("the Update button", () => {
  test("posts to the spec's own update action", () => {
    const html = page();
    expect(html).toContain('action="/api/queue/specs/aide/150-one-page-shows-the-whole-spec/update"');
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toContain("Update");
  });

  test("a refusal is shown on the page the button was pressed from", () => {
    const html = page(view({ error: "the specs checkout has uncommitted changes" }));
    expect(html).toContain("the specs checkout has uncommitted changes");
  });

  test("what the pull DID is shown the same way", () => {
    const html = page(view({ notice: { note: "pulled a3f9c21 → 7b1e004", ok: true } }));
    expect(html).toContain("pulled a3f9c21 → 7b1e004");
  });
});

// --- the frame --------------------------------------------------------------
