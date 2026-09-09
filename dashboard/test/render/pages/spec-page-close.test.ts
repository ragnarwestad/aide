// Spec 406: the Close control, the shared Reset/Close distinction
// sentence, and the closed-spec read-only line. Follows the shape
// spec-page-reopen-and-reset.test.ts's own Reset suite already tests
// against.

import { describe, expect, test } from "bun:test";
import { renderCloseSpecPage, type SpecPageView } from "../../../src/render.ts";
import { GENERATED, NAV, page, view } from "./spec-page-fixtures.ts";

describe("spec 406, REQ-1: the Close control", () => {
  test("present and enabled beside Reset when both actions are offered", () => {
    const html = page(view({ resetAction: "/reset-confirm", closeAction: "/close-confirm" }));
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
    expect(html).toContain("a job is running");
    expect(html).not.toContain('href="/close-confirm"');
    expect(html).toContain('aria-disabled="true"');
  });

  test("a live spec with no closeAction offers nothing of the sort", () => {
    expect(page(view())).not.toContain(">Close<");
  });
});

describe("spec 406, REQ-2: the Reset/Close distinction is visible page text, not only a hover title", () => {
  test("present whenever either control is drawn", () => {
    const html = page(view({ resetAction: "/reset-confirm", closeAction: "/close-confirm" }));
    const withoutTitles = html.replace(/title="[^"]*"/g, "");
    expect(withoutTitles).toContain("Reset starts this spec over and keeps it active");
    expect(withoutTitles).toContain("Close says it will not work");
  });

  test("absent once the spec is archived — nothing left to distinguish", () => {
    const html = page(view({ archived: true, resetAction: "/reset-confirm", closeAction: "/close-confirm" }));
    expect(html).not.toContain("Reset starts this spec over");
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
  test("states the branch-deletion warning and repeats the Reset/Close distinction", () => {
    const html = renderCloseSpecPage("aide", view().specFolder, NAV, GENERATED, { token: "t0ken" });
    const withoutTitles = html.replace(/title="[^"]*"/g, "");
    expect(withoutTitles).toMatch(/branch.*delet|delet.*branch/i);
    expect(withoutTitles).toContain("Reset starts this spec over and keeps it active");
    expect(withoutTitles).toContain("Close says it will not work");
  });

  test("carries a reason field and posts to the close route", () => {
    const html = renderCloseSpecPage("aide", view().specFolder, NAV, GENERATED, { token: "t0ken" });
    expect(html).toContain(`/api/queue/specs/aide/${view().specFolder}/close`);
    expect(html).toContain('name="reason"');
    expect(html).toContain('name="token" value="t0ken"');
  });

  test("the title sits inside .backhead, right after ← Back", () => {
    const html = renderCloseSpecPage("aide", view().specFolder, NAV, GENERATED, { token: "t0ken" });
    expect(html).toContain(
      `<div class="backhead"><a class="backlink" href="/specs/aide/${view().specFolder}">← Back</a>` +
        `<h1>Close ${view().specFolder}</h1></div>`,
    );
  });
});

describe("the Close page covers the page while the work runs", () => {
  test("Close's form asks for the layer, and names what is happening", () => {
    const html = renderCloseSpecPage("aide", view().specFolder, NAV, GENERATED, { token: "t0ken" });
    const form = html.match(/<form[^>]*action="[^"]*\/close"[^>]*>/)?.[0] ?? "";
    expect(form).toContain('data-overlay="closing…"');
  });

  // Spec 422, REQ-2: the same text, in the reader's own language.
  test("in Norwegian (nb), the overlay text is the Norwegian one", () => {
    const html = renderCloseSpecPage("aide", view().specFolder, NAV, GENERATED, { token: "t0ken", lang: "nb" });
    const form = html.match(/<form[^>]*action="[^"]*\/close"[^>]*>/)?.[0] ?? "";
    expect(form).toContain('data-overlay="lukker…"');
  });
});
