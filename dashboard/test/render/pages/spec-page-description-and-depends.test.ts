// Split out of spec-page.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { renderJobDetailPage, type SpecPageView } from "../../../src/render.ts";
import { GENERATED, NAV, NOW, file, lead, page, view } from "./spec-page-fixtures.ts";

describe("spec 212: the Edit link that led to a second page is gone", () => {
  test("no tab offers one, and the page it led to is not linked anywhere", () => {
    for (const tab of ["checks", "description", "analysis", "solution", "status"]) {
      expect([tab, page(view(), tab).includes("/edit")]).toEqual([tab, false]);
    }
  });

  // The job page draws its phase's file through the same function.
  test("never appears on a job page's phase file either", () => {
    const html = renderJobDetailPage(
      lead({ phase: { label: "2-analysis.md", text: "## Findings\n", sha: "a3f9c21", at: "2026-08-21T09:14:00+02:00" } }),
      GENERATED,
      NAV,
      { now: NOW },
    );
    expect(html).toContain("2-analysis.md");
    expect(html).not.toContain("/edit");
  });
});

describe("the Description tab", () => {
  const edit = (v: SpecPageView = view()) => page(v, "description");

  test("holds the file's current text in a real textarea, in a real form", () => {
    const html = edit();
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toContain('action="/api/queue/specs/aide/150-one-page-shows-the-whole-spec/save"');
    expect(html).toContain("<textarea");
    expect(html).toContain("The dashboard never shows a spec.");
  });

  // REQ-2: the save route now takes the file as part of the request —
  // Description's own form names itself, same as the other three tabs.
  test("names which file the Save is about", () => {
    expect(edit()).toContain('<input type="hidden" name="file" value="1-description.md">');
  });

  test("wide description lines stay on one line and scroll inside the field", () => {
    const html = edit();
    expect(html).toContain('<textarea name="text" rows="30" spellcheck="false" wrap="off" class="spec-editor-raw">');
    expect(html).toContain('.newspecform textarea { overflow-x: auto; }');
  });

  // REQ-1: the WYSIWYG mount point sits beside the real textarea, which
  // stays the actual submitted form field (2-analysis.md's "needs NO
  // change" finding about the save route) — CSS hides one or the other
  // depending on whether the client script mounted (see css/field.css).
  test("carries the editor's mount point beside the raw textarea", () => {
    const html = edit();
    expect(html).toContain('<div class="spec-editor-mount" id="spec-editor-host"></div>');
    expect(html.indexOf('id="spec-editor-host"')).toBeLessThan(html.indexOf('class="spec-editor-raw"'));
  });

  test("the Save row has one spacing token above it", () => {
    expect(edit()).toContain('.specform .factions { margin-top: var(--sp-1); }');
  });

  // The description says "each with the commit stamp it has today" —
  // the tab that can be edited included.
  test("carries the file's commit stamp, exactly as the read-only tabs do", () => {
    expect(edit()).toContain("a3f9c21");
  });

  // The whole point of the hidden field: the page is rendered once and
  // a reader may sit on it while an analyze step lands a new version.
  test("carries the commit the text was read at, so a save can be refused", () => {
    expect(edit(view({ formBaseSha: "a3f9c21deadbeef" }))).toContain('value="a3f9c21deadbeef"');
  });

  // A spec whose description git has never seen still opens: the field
  // is empty rather than the word "undefined".
  test("a file with no commit yet opens all the same", () => {
    const html = edit(view({ formBaseSha: undefined }));
    expect(html).toContain("<textarea");
    expect(html).not.toContain("undefined");
  });

  // Saving here commits and pushes, which takes two or three seconds,
  // and this page carries no script of its own — so the shell's own
  // must be what marks the button busy. Without it the Save looks
  // untouched for those seconds and reads as a press that did not
  // register (asked for 2026-08-23).
  test("the shell's busy script comes with the page, so Save looks pressed", () => {
    const html = edit();
    expect(html).toContain('data-pending="saving…"');
    // The transpiled listener itself, not just its effect: this page
    // is served with no `script` of its own, so the head tag is the
    // only place it can come from.
    expect(html).toContain('addEventListener("submit"');
    expect(html).toContain("dataset.busy");
    expect(html).not.toContain("<script src");
  });

  test("the text is escaped — a description is arbitrary text off disk", () => {
    const html = edit(view({ files: [file("1-description.md", "</textarea><script>alert(1)</script>")] }));
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;/textarea&gt;");
  });

  // A ten-second meta refresh on a page with a textarea on it wipes
  // whatever the reader was half-way through typing. This is why the
  // form could not live here before spec 212.
  test("does not refresh itself under the reader", () => {
    expect(edit()).not.toContain('http-equiv="refresh"');
  });

  test("a refused save has somewhere to show its reason", () => {
    const html = edit(view({ error: "1-description.md has changed since you opened it" }));
    expect(html).toContain("1-description.md has changed since you opened it");
  });

  test("carries the token for a browser that got the page with one", () => {
    expect(edit(view({ token: "s3cret" }))).toContain('name="token" value="s3cret"');
  });

  // Spec 163: an archived spec is a RECORD. Editing was built for a
  // description that is edited WHILE the work is live (spec 162), and
  // Save on an archived spec would have written, committed and pushed
  // into `archive/`.
  test("an archived spec's description is read-only, with the note that says why", () => {
    const html = edit(view({ archived: true }));
    expect(html).not.toContain("<textarea");
    expect(html).toContain("The dashboard never shows a spec.");
    expect(html).toContain("archived");
  });

  // --- spec 174, moved with the form: the New-spec page's own picker -------
  //
  // The dependency line is stored in `1-description.md`'s own text, so
  // the control that changes it stays with that file's own Save — one
  // commit for the description and the line together, exactly as
  // before. Overview shows the same thing read-only.
  describe("the Depends on picker", () => {
    const OPTIONS = [
      { project: "aide", specFolder: "164-a-spec-can-depend" },
      { project: "aide", specFolder: "09-ninth" },
    ];
    const withOptions = (checked: string[] = []) =>
      edit(view({ dependsOnOptions: OPTIONS, dependsOn: checked }));

    test("one checkbox per spec offered, not a text box to type into", () => {
      const html = withOptions();
      expect(html).toContain('name="dependsOn"');
      expect(html).toContain('value="164-a-spec-can-depend"');
      expect(html).toContain('value="09-ninth"');
      expect(html).not.toContain('<input type="text" name="dependsOn"');
    });

    // The same order the New-spec page draws: newest first, because the
    // number is the order a reader thinks in.
    test("newest first, as on the New-spec page", () => {
      const html = withOptions();
      expect(html.indexOf('value="164-a-spec-can-depend"')).toBeLessThan(html.indexOf('value="09-ninth"'));
    });

    test("what the spec already depends on is ticked", () => {
      const html = withOptions(["164-a-spec-can-depend"]);
      expect(html).toMatch(/value="164-a-spec-can-depend"[^>]*checked/);
      expect(html).not.toMatch(/value="09-ninth"[^>]*checked/);
    });

    test("a spec that depends on nothing has nothing ticked", () => {
      // The boxes themselves: the page's stylesheet has a `.checked`
      // rule in it, which a search of the whole document would find.
      const boxes = [...withOptions().matchAll(/<input[^>]*name="dependsOn"[^>]*>/g)].map((m) => m[0]);
      expect(boxes).toHaveLength(2);
      for (const box of boxes) expect(box).not.toContain("checked");
    });

    // A project with one spec in it — the one being edited — has
    // nothing to offer, and the server has already left it out. The
    // field is then absent rather than an empty box (the New-spec page
    // does the same).
    test("nothing to depend on, no field", () => {
      const html = edit(view({ dependsOnOptions: [], dependsOn: [] }));
      expect(html).not.toContain('name="dependsOn"');
      // The note about when a dependency takes effect goes with it:
      // there is nothing on the page for it to be about.
      expect(html).not.toContain("next gated step");
    });

    test("the note about when it takes effect stays beside the picker", () => {
      expect(withOptions()).toContain("next gated step");
    });

    // An archived spec has no form to put the picker in.
    test("an archived spec is offered no picker", () => {
      expect(edit(view({ archived: true, dependsOnOptions: OPTIONS }))).not.toContain('name="dependsOn"');
    });
  });
});

// --- spec 212: what the spec depends on, read-only, in the banner -----------
//
// Spec 294 moved this fact (and `archivedLine`) from the Overview panel
// into the banner itself, so it renders on every tab, not just one — the
// same visibility the removed state chip had.

describe("spec 212: the Depends on line, in the banner on every tab", () => {
  test("names what the spec depends on, and posts nothing", () => {
    const html = page(view({ dependsOn: ["164-a-spec-can-depend", "09-ninth"] }));
    expect(html).toContain("<strong>Depends on</strong>");
    expect(html).toContain("164-a-spec-can-depend");
    expect(html).toContain("09-ninth");
    // The read-only line, not the picker: the control that changes it
    // is on the Description tab, with the file the line is stored in.
    expect(html).not.toContain('name="dependsOn"');
  });

  // Criterion 7: the banner is built once, before the tab switch, and
  // returned unconditionally — so a non-checks tab carries the same fact
  // line rather than it being Checks-only as it was on the old Overview.
  test("still renders on a non-checks tab, since the banner is unconditional (criterion 7)", () => {
    const html = page(view({ dependsOn: ["164-a-spec-can-depend"] }), "description");
    expect(html).toContain("<strong>Depends on</strong>");
    expect(html).toContain("164-a-spec-can-depend");
  });

  // The same convention `dependsOnField` keeps for a project with
  // nothing to offer: nothing to say, no line.
  // The words themselves are in the page's own stylesheet, in a
  // comment about the New-spec form's layout — so the claim is about
  // the LINE, not about the document.
  test("a spec that depends on nothing draws no line at all", () => {
    expect(page(view({ dependsOn: [] }))).not.toContain("<strong>Depends on</strong>");
    expect(page(view())).not.toContain("<strong>Depends on</strong>");
  });

  // An archived spec is a record — the line is a fact about it, and a
  // fact is not a control.
  test("an archived spec still shows it, read-only", () => {
    const html = page(view({ archived: true, dependsOn: ["164-a-spec-can-depend"] }));
    expect(html).toContain("164-a-spec-can-depend");
    expect(html).not.toContain('name="dependsOn"');
  });

  // A folder name is arbitrary text off disk.
  test("the folder names are escaped", () => {
    const html = page(view({ dependsOn: ['<img src=x onerror="alert(1)">'] }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
