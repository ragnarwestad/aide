// Spec 406: the Close control and the sentence that says what it means
// sentence, and the closed-spec read-only line. Follows the shape
// spec-page-reopen-and-reset.test.ts's own Reset suite already tests
// against.

import { describe, expect, test } from "bun:test";
import { renderCloseSpecPage, type SpecPageView } from "../../../../src/render";
import { GENERATED, NAV, page, view } from "../spec-page-fixtures.ts";

describe("spec 406, REQ-1: the Close control", () => {
  test("present and enabled beside Reset when both actions are offered", () => {
    const html = page(view({ closeAction: "/close-confirm" }));
    const group = /<nav class="tabbar subtabs">[\s\S]*?<span class="row">([\s\S]*?)<\/span><\/nav>/.exec(html)?.[1] ?? "";
    expect(group).toContain('href="/close-confirm"');
    expect(group).toContain("Close");
    expect(group.indexOf("Reset")).toBeLessThan(group.indexOf("Close"));
  });

  // REQ-1: "whatever phase it is in, including one where no step has
  // completed" — the render layer draws off `closeAction` alone, which
  // the server sets unconditionally for every non-archived spec
  // (spec-views/spec-page.ts), so a `created`-phase spec with no
  // `done` steps at all still gets the control.
  test("present even when no phase has completed yet", () => {
    const html = page(view({ closeAction: "/close-confirm", done: [] }));
    expect(html).toContain('href="/close-confirm"');
  });

  test("the link carries data-close-ask, and the close page draws none (AC-2)", () => {
    expect(page(view({ closeAction: "/close-confirm" }))).toContain('href="/close-confirm" data-close-ask');
    expect(renderCloseSpecPage("aide", view().specFolder, NAV, GENERATED, {})).not.toContain("data-close-ask");
  });

  test("absent for an archived spec", () => {
    expect(page(view({ archived: true, closeAction: "/close-confirm" }))).not.toContain("/close-confirm");
  });

  test("absent for a closed spec (closed implies archived)", () => {
    const html = page(view({ archived: true, closed: true, closeAction: "/close-confirm" }));
    expect(html).not.toContain("/close-confirm");
  });

  test("disabled with its reason while busy, rather than absent or silently inert (REQ-11)", () => {
    const html = page(view({ closeAction: "/close-confirm", closeUnavailableReason: "a job is running" }));
    expect(html).toContain("Close");
    expect(html).not.toContain('href="/close-confirm"');
    expect(html).toContain('aria-disabled="true"');
    // Spec 454: the reason is not a `title`. Spec 457: nor is it Close's
    // own "(?)" any more — it is one sentence inside the action row's
    // single shared mark, naming Close by name.
    expect(html).not.toMatch(/title="a job is running"/);
    expect(html).toContain("Close can't run right now because a job is running.");
  });

  test("a live spec with no closeAction offers nothing of the sort", () => {
    expect(page(view())).not.toContain(">Close<");
  });

  // Spec 437, AC-1/AC-2: the Close confirmation is a subpage.
  test("draws no site-level tab bar", () => {
    const html = renderCloseSpecPage("aide", view().specFolder, NAV, GENERATED, {});
    expect(html).not.toContain('<nav class="tabbar">');
  });

  // design-system.md, "What a button's variant means": `danger` is an
  // action a mistake cannot undo, and closing deletes the spec's code
  // branch without merging it. Every other `saveCancelActions()` form
  // saves text and stays `primary`.
  test("its submit is danger, not the primary every other form's Save is", () => {
    const html = renderCloseSpecPage("aide", view().specFolder, NAV, GENERATED, {});
    const save = /<button id="specform-save"[^>]*>/.exec(html)?.[0] ?? "";
    expect(save).toContain("danger");
    expect(save).not.toContain("primary");
  });
});

describe("spec 406, REQ-2: what Close means is visible page text, not only a hover title", () => {
  test("present whenever either control is drawn", () => {
    const html = page(view({ closeAction: "/close-confirm" }));
    const withoutTitles = html.replace(/title="[^"]*"/g, "");
    expect(withoutTitles).toContain("Close says this spec will not work and archives it as a record");
  });

  test("absent once the spec is archived — nothing left to distinguish", () => {
    const html = page(view({ archived: true, closeAction: "/close-confirm" }));
    expect(html).not.toContain("Close says this spec will not work and archives it as a record");
  });
});

describe("spec 406, REQ-7: a closed spec reads as closed, never as archived", () => {
  const closedView = (extra: Partial<SpecPageView> = {}) =>
    view({ archived: true, closed: true, closedDate: "2026-09-05", closeReason: "this idea does not hold", ...extra });

  test("the read-only line names the reason and the date, and never says archived", () => {
    const html = page(closedView());
    expect(html).toContain("This spec was closed");
    expect(html).toContain("2026-09-05");
    expect(html).toContain("this idea does not hold");
    expect(html).not.toContain("This spec has been archived");
    // Scoped to the banner's own read-only line, not the whole page:
    // the shell's unrelated chrome (CSS class names, the About dialog,
    // a document tab's own generic help text) legitimately says
    // "archived" elsewhere and is not what REQ-7 is about.
    const desc = /<p class="desc">[\s\S]*?<\/p>/.exec(html)?.[0] ?? "";
    expect(desc).not.toMatch(/\barchived\b/i);
  });

  test("a plainly archived spec (not closed) still reads the old way", () => {
    const html = page(view({ archived: true, closed: false }));
    expect(html).toContain("This spec has been archived");
    expect(html).not.toContain("This spec was closed");
  });

  // REQ-10: nothing on a closed spec's page is editable — it shares the
  // exact `view.archived` gate every other read-only surface already
  // uses (documentPanel, checklist), so this is a regression guard
  // rather than new logic.
  test("no editable form is drawn — description, checks or tracking", () => {
    const html = page(closedView());
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('class="checkbox"><input type="checkbox" name="tick"');
    expect(html).not.toContain('method="post" action="/api/queue/specs/aide/150-one-page-shows-the-whole-spec/save"');
  });
});

describe("spec 406, REQ-2/REQ-9: the Close confirmation page", () => {
  test("states the branch-deletion warning and repeats what Close means", () => {
    const html = renderCloseSpecPage("aide", view().specFolder, NAV, GENERATED, {});
    const withoutTitles = html.replace(/title="[^"]*"/g, "");
    expect(withoutTitles).toMatch(/branch.*delet|delet.*branch/i);
    expect(withoutTitles).toContain("Close says this spec will not work and archives it as a record");
  });

  test("carries a reason field and posts to the close route", () => {
    const html = renderCloseSpecPage("aide", view().specFolder, NAV, GENERATED, {});
    expect(html).toContain(`/api/queue/specs/aide/${view().specFolder}/close`);
    expect(html).toContain('name="reason"');
  });

  test("the title sits inside .backhead, right after ← Back", () => {
    const html = renderCloseSpecPage("aide", view().specFolder, NAV, GENERATED, {});
    expect(html).toContain(
      `<div class="backhead"><a class="backlink" href="/specs/aide/${view().specFolder}">← Back</a>` +
        `<h1>Close ${view().specFolder}</h1></div>`,
    );
  });
});

describe("the Close page says what is happening while the work runs (AC-2)", () => {
  const dialogOf = (html: string): string => html.match(/<dialog[^>]*data-progress-dialog[\s\S]*?<\/dialog>/)?.[0] ?? "";

  test("the form holds a modal dialog titled Closing…, with no button, and names the spec page", () => {
    const html = renderCloseSpecPage("aide", view().specFolder, NAV, GENERATED, {});
    const form = html.match(/<form[^>]*action="[^"]*\/close"[^>]*>/)?.[0] ?? "";
    expect(form).toContain(`data-progress="/specs/aide/${view().specFolder}"`);
    expect(form).toContain('method="post"');
    expect(form).not.toContain("data-overlay");
    const dialog = dialogOf(html);
    expect(dialog).toContain('class="confirmdialog"');
    expect(dialog).toContain("Closing…");
    expect(dialog).not.toContain("<button");
    expect(html.match(/<form[^>]*data-progress=[\s\S]*?<\/form>/)?.[0]).toContain("data-progress-dialog");
  });

  test("in Norwegian (nb), the title is the Norwegian one", () => {
    const html = renderCloseSpecPage("aide", view().specFolder, NAV, GENERATED, { lang: "nb" });
    expect(dialogOf(html)).toContain("Lukker…");
  });

  test("the reason still posts to the close route (AC-3)", () => {
    const html = renderCloseSpecPage("aide", view().specFolder, NAV, GENERATED, {});
    expect(html).toContain('name="reason"');
    expect(html).toContain(`action="/api/queue/specs/aide/${view().specFolder}/close"`);
  });
});

// Spec 513: the Close reason's bound reaches the script as data, and the
// browser applies none of its own with script off.
describe("spec 513: the Close reason's bound", () => {
  test("carries data-maxlength and no maxlength, and no count is drawn (AC-5)", () => {
    const html = renderCloseSpecPage("aide", view().specFolder, NAV, GENERATED, {});
    const reason = /<textarea name="reason"[^>]*>/.exec(html)?.[0] ?? "";
    expect(reason).toContain('data-maxlength="5000"');
    expect(reason).not.toMatch(/\smaxlength=/);
    // The stylesheet names the markers; no element may carry one.
    expect(html).not.toMatch(/<[a-z]+ [^>]*data-limit/);
  });
});
