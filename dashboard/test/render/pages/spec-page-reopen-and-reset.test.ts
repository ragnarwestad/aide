// Split out of spec-page.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { renderResetSpecPage, type SpecPageView } from "../../../src/render.ts";
import { GENERATED, NAV, page, view } from "./spec-page-fixtures.ts";

// --- spec 198: reopening a spec is one action -------------------------------
//
// An archived spec whose work has to be done again was reopened by hand
// in a terminal — move the folder, overwrite three files, hunt down the
// branch in two repositories and two places each. Done twice, missed
// something both times. The control belongs where the spec is.
//
// Everything ELSE about an archived spec stays as spec 163 left it: no
// textarea on the Description tab, the same read-only note, and checks
// that are shown but cannot be ticked.
describe("spec 198: the Reopen control", () => {
  const archived = (extra: Partial<SpecPageView> = {}) =>
    page(view({ archived: true, token: "t0ken", ...extra }));

  test("an archived spec offers exactly one action, and it is Reopen", () => {
    const html = archived();
    expect(html).toContain("Reopen");
    expect(html).toContain('action="/api/queue"');
    expect(html).toContain('name="steps" value="reopen"');
  });

  test("it names the spec the server has to resolve, and carries the token", () => {
    const html = archived();
    expect(html).toContain('name="project" value="aide"');
    expect(html).toContain('name="specFolder" value="150-one-page-shows-the-whole-spec"');
    expect(html).toContain('name="token" value="t0ken"');
  });

  // A GET would let a reload re-run it, exactly as the Update button's
  // own comment says of the pull.
  test("it posts", () => {
    expect(archived()).toMatch(/<form[^>]*action="\/api\/queue"[^>]*method="post"|<form[^>]*method="post"[^>]*action="\/api\/queue"/);
  });

  // Reopen sat under the archived note while Update sat up on the head
  // line, so the page's two buttons were in two places (2026-08-23,
  // "Reopen og Update kan vel gjerne stå sammen?"). One group now, at
  // the end of the tab row (spec 300 moved it off its own line above
  // the tabs).
  test("Reopen and Update share one group at the end of the tab row", () => {
    const group = /<nav class="tabbar subtabs">[\s\S]*?<span class="row">([\s\S]*?)<\/span><\/nav>/.exec(archived())?.[1] ?? "";
    expect(group).toContain("Reopen");
    expect(group).toContain("Update");
    // Reopen FIRST: Update is on every spec page, and a button that
    // slid sideways whenever a spec was archived would be moving
    // because something else appeared.
    expect(group.indexOf("Reopen")).toBeLessThan(group.indexOf("Update"));
    // Moved, not copied: one Reopen on the page, and it is this one.
    expect(archived().match(/name="steps" value="reopen"/g)).toHaveLength(1);
  });

  // "This spec is archived — a record, and read-only." was a notice
  // under the title until 2026-08-23. Two things were wrong with it:
  // the page uses that shape for something that just happened, not for
  // something that is the case, and "read-only" is a truth with
  // modifications — Reopen is on the head line, and archive can be run
  // again while the branch is open. Spec 300 then dropped the
  // "Archived" label itself: the sentence already says what is the
  // case, and a label running into it ("Archived the folder has
  // moved...") read as one thing typed against another.
  test("being archived is one self-contained sentence, and does not claim read-only", () => {
    const html = archived();
    expect(html).not.toContain("<strong>Archived</strong>");
    expect(html).toContain(
      "This spec has been archived, and cannot be edited until the spec is reopened",
    );
    // The About dialog in the shell calls the dashboard itself
    // read-only, so it is the old SENTENCE that must be gone.
    expect(html).not.toContain("a record, and read-only");
    expect(html).not.toContain("This spec is archived");
    // Not the notice shape: that one is for what just happened.
    expect(html).not.toMatch(/class="rowmsg info"[^>]*>[\s\S]{0,80}archived/);
  });

  test("a live spec says nothing about being archived", () => {
    expect(page(view({ token: "t0ken" }))).not.toContain("<strong>Archived</strong>");
  });

  // A live spec has the whole row on the queue list for this; the
  // archived page is the one place a reopen can be asked for.
  test("a live spec's page offers nothing of the sort", () => {
    expect(page(view({ token: "t0ken" }))).not.toContain("Reopen");
  });

  test("the archived note is unchanged, and nothing on the page edits", () => {
    const html = archived();
    expect(html).not.toContain("/edit");
    expect(html).toContain("archived");
    expect(page(view({ archived: true }), "description")).not.toContain("<textarea");
  });
});

describe("spec 252: the spec page's own Back link", () => {
  test("← Back tracks the given backHref", () => {
    const html = page(view({ backHref: "/?state=all&q=archive" }));
    expect(html).toContain('<a class="backlink" href="/?state=all&amp;q=archive">← Back</a>');
  });

  test("← Back falls back to / when nothing was given", () => {
    const html = page();
    expect(html).toContain('<a class="backlink" href="/">← Back</a>');
  });
});

describe("spec 231: the Reset control", () => {
  test("an active spec offers Reset immediately before Update", () => {
    const html = page(view({ resetAction: "/reset-confirm" }));
    const group = /<nav class="tabbar subtabs">[\s\S]*?<span class="row">([\s\S]*?)<\/span><\/nav>/.exec(html)?.[1] ?? "";
    expect(group).toContain('href="/reset-confirm"');
    expect(group.indexOf("Reset")).toBeLessThan(group.indexOf("Update"));
  });

  // Disabled, not hidden, on an archived spec (2026-09-09): a control
  // that vanishes leaves the reader wondering where it went.
  test("Reset is disabled for an archived spec, with the reason, and unavailable while busy", () => {
    const archived = page(view({ archived: true, resetAction: "/reset-confirm" }));
    expect(archived).not.toContain('href="/reset-confirm"');
    expect(archived).toMatch(/<span class="btn" aria-disabled="true" title="an archived spec cannot be reset[^"]*">Reset<\/span>/);
    const html = page(view({ resetAction: "/reset-confirm", resetUnavailableReason: "a job is running" }));
    expect(html).toContain("Reset");
    expect(html).toContain("a job is running");
    expect(html).not.toContain('href="/reset-confirm"');
    // Spec 321: the markup already says aria-disabled, but nothing
    // styled it until button.css gained the matching selector.
    expect(html).toContain('aria-disabled="true"');
  });

  // The page asks the question in a sentence and offers the two
  // answers (2026-09-08). It made the reader type the folder name back
  // into a field until then — on a page whose own heading is that name.
  test("the confirmation explains every effect and asks in a sentence", () => {
    const html = renderResetSpecPage("aide", view().specFolder, NAV, GENERATED, { token: "t0ken" });
    for (const text of [
      "0-README.md", "1-description.md", "analysis", "plan", "status",
      "local and remote", "earlier jobs and commits", "Project code", "default-branch history",
    ]) expect(html).toContain(text);
    expect(html).toContain(`Are you sure you want to reset ${view().specFolder}? This cannot be undone.`);
    expect(html).toContain('name="token" value="t0ken"');
    // Nothing to type, and nothing that reads what was typed.
    expect(html).not.toContain("data-confirm=");
    expect(html).not.toContain('name="confirm"');
  });

  // The press has to be live from the moment the page is drawn: there
  // is no field on this form to change, so a button that waits for one
  // would never enable.
  test("Reset is a live danger button, and Cancel goes back to the spec", () => {
    const html = renderResetSpecPage("aide", view().specFolder, NAV, GENERATED, { token: "t0ken" });
    const button = html.match(/<button[^>]*>Reset<\/button>/)?.[0] ?? "";
    expect(button).toContain("danger");
    expect(button).not.toContain("disabled");
    expect(button).not.toContain('aria-disabled="true"');
    expect(html).toContain(`<a class="btn" href="/specs/aide/${view().specFolder}">Cancel</a>`);
  });

  // Spec 252, Criteria 7, 8: "← Back" still heads the page, at the
  // spec's own page, reached only from that page's Overview banner.
  test("Back heads the page, to the spec's own page", () => {
    const html = renderResetSpecPage("aide", view().specFolder, NAV, GENERATED, { token: "t0ken" });
    expect(html).toContain(`<a class="backlink" href="/specs/aide/${view().specFolder}">← Back</a>`);
  });

  // Spec 296: "Reset <specFolder>" sits beside ← Back, on one line.
  test("the title sits inside .backhead, right after ← Back, and appears as <h1> exactly once", () => {
    const html = renderResetSpecPage("aide", view().specFolder, NAV, GENERATED, { token: "t0ken" });
    expect(html).toContain(
      `<div class="backhead"><a class="backlink" href="/specs/aide/${view().specFolder}">← Back</a>` +
        `<h1>Reset ${view().specFolder}</h1></div>`,
    );
    expect(html.match(new RegExp(`<h1>Reset ${view().specFolder}</h1>`, "g"))?.length ?? 0).toBe(1);
  });
});

// A press that deletes this spec's branches and starts it over ends with
// the page gone. `data-overlay` is what asks the shell's covering layer
// to say so — without it the button swaps its own word and leaves every
// other control on the page live under the reader's cursor.
describe("the confirmation pages cover the page while the work runs", () => {
  test("Reset's form asks for the layer, and names what is happening", () => {
    const html = renderResetSpecPage("aide", view().specFolder, NAV, GENERATED, { token: "t0ken" });
    const form = html.match(/<form[^>]*action="[^"]*\/reset"[^>]*>/)?.[0] ?? "";
    expect(form).toContain('data-overlay="resetting…"');
  });

  // Spec 422, REQ-2: the same text, in the reader's own language.
  test("in Norwegian (nb), the overlay text is the Norwegian one", () => {
    const html = renderResetSpecPage("aide", view().specFolder, NAV, GENERATED, { token: "t0ken", lang: "nb" });
    const form = html.match(/<form[^>]*action="[^"]*\/reset"[^>]*>/)?.[0] ?? "";
    expect(form).toContain('data-overlay="nullstiller…"');
  });
});
