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

  // Spec 391: Save moved onto the panel's own head line, above the
  // field it saves rather than below it — `.panelhead` carries the one
  // spacing token to the field beneath it now.
  test("the panel head carries one spacing token down to the field below it", () => {
    expect(edit()).toMatch(/\.panelhead\s*\{[^}]*margin-bottom:\s*var\(--sp-2\)/);
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

  // Spec 394 (REQ-1) moved the Depends on picker out of this tab's own
  // form and into the banner above the tab row — see the describe block
  // below. This tab's own Save form no longer carries it at all, though
  // the banner above it (part of every page) still does.
  test("no Depends on field inside this tab's own Save form", () => {
    const html = edit(view({
      dependsOnOptions: [{ project: "aide", specFolder: "164-a-spec-can-depend" }],
      dependsOn: ["164-a-spec-can-depend"],
    }));
    const saveForm = html.slice(html.indexOf('action="/api/queue/specs/aide/150-one-page-shows-the-whole-spec/save"'));
    expect(saveForm).not.toContain('name="dependsOn"');
  });
});

// --- spec 394 (REQ-1, REQ-2, REQ-4): what the spec depends on, and
// whether it requires acceptance ticking, editable in the banner ------------
//
// Spec 294 moved the (then read-only) "Depends on" fact from the
// Overview panel into the banner, so it rendered on every tab. Spec 394
// moves the PICKER itself there too — a dependency is a fact about the
// spec, not about the Description document, and REQ-4 drops the
// separate read-only echo this banner used to draw beside it.

describe("spec 394: the Depends on picker, in the banner on every tab", () => {
  const OPTIONS = [
    { project: "aide", specFolder: "164-a-spec-can-depend" },
    { project: "aide", specFolder: "09-ninth" },
  ];
  const withOptions = (checked: string[] = []) =>
    page(view({ dependsOnOptions: OPTIONS, dependsOn: checked }));

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

  // A project with one spec in it — the one being edited — has nothing
  // to offer, and the server has already left it out. The field is then
  // absent rather than an empty box (the New-spec page does the same).
  test("nothing to depend on, no field", () => {
    const html = page(view({ dependsOnOptions: [], dependsOn: [] }));
    expect(html).not.toContain('name="dependsOn"');
    // The note about when a dependency takes effect goes with it: there
    // is nothing on the page for it to be about.
    expect(html).not.toContain("next gated step");
  });

  test("the note about when it takes effect stays beside the picker", () => {
    expect(withOptions()).toContain("next gated step");
  });

  // REQ-4: the fact is shown once — inside the control — never as a
  // separate read-only "Depends on: ..." sentence beside it.
  test("no separate read-only echo of the dependency beside the control", () => {
    expect(withOptions(["164-a-spec-can-depend"])).not.toContain("<strong>Depends on</strong>");
  });

  // Criterion 7: the banner is built once, before the tab switch, and
  // returned unconditionally — so a non-description tab carries the same
  // control rather than it being Description-only as it was before.
  test("still renders on a non-description tab, since the banner is unconditional", () => {
    const html = page(view({ dependsOnOptions: OPTIONS, dependsOn: ["164-a-spec-can-depend"] }), "checks");
    expect(html).toContain('name="dependsOn"');
    expect(html).toMatch(/value="164-a-spec-can-depend"[^>]*checked/);
  });

  // REQ-7: an archived spec is a record — read-only, no form.
  test("an archived spec shows the dependency read-only, with no picker", () => {
    const html = page(view({ archived: true, dependsOnOptions: OPTIONS, dependsOn: ["164-a-spec-can-depend"] }));
    expect(html).toContain("164-a-spec-can-depend");
    expect(html).not.toContain('name="dependsOn"');
  });

  // A folder name is arbitrary text off disk.
  test("the folder names are escaped", () => {
    const html = page(view({ archived: true, dependsOn: ['<img src=x onerror="alert(1)">'] }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

// --- spec 404: what is picked sits above the scrolling list -----------------
//
// The picker renders every option newest-first in one capped, scrolling
// list, so a spec's own already-ticked dependencies can be wherever the
// sort put them — not necessarily inside the visible first few rows.
// A second, uncapped block ahead of the scrolling one holds exactly the
// ticked chips instead.

describe("spec 404: what is picked sits above the scrolling list", () => {
  const OPTIONS = [
    { project: "aide", specFolder: "164-a-spec-can-depend" },
    { project: "aide", specFolder: "09-ninth" },
  ];
  const withOptions = (checked: string[] = []) =>
    page(view({ dependsOnOptions: OPTIONS, dependsOn: checked }));

  // REQ-1: what is already picked sits in an uncapped block ahead of the
  // scrolling list.
  test("a ticked chip sits inside .phases.picked, ahead of the scrolling .phases list, uncapped", () => {
    const html = withOptions(["164-a-spec-can-depend"]);
    const pickedIdx = html.indexOf('class="phases picked"');
    const restIdx = html.indexOf('class="phases"');
    expect(pickedIdx).toBeGreaterThan(-1);
    expect(restIdx).toBeGreaterThan(-1);
    expect(pickedIdx).toBeLessThan(restIdx);
    const pickedBlock = html.slice(pickedIdx, restIdx);
    expect(pickedBlock).toContain('value="164-a-spec-can-depend"');
  });

  // REQ-2: unticking (the outcome of a save with the box unchecked)
  // returns the chip to the scrolling list alone.
  test("an unticked option appears only in the scrolling list, never in the picked block", () => {
    const html = withOptions([]);
    expect(html).toContain('class="phases picked"></span>');
    const restIdx = html.indexOf('class="phases"');
    const restBlock = html.slice(restIdx);
    expect(restBlock).toContain('value="164-a-spec-can-depend"');
  });

  // REQ-3: ticking a previously-unpicked option (the outcome of a save
  // with the box checked) lifts it into the picked block.
  test("a newly ticked option appears in the picked block", () => {
    const html = withOptions(["09-ninth"]);
    const pickedIdx = html.indexOf('class="phases picked"');
    const restIdx = html.indexOf('class="phases"');
    const pickedBlock = html.slice(pickedIdx, restIdx);
    expect(pickedBlock).toContain('value="09-ninth"');
  });

  // Every chip in both halves still posts the one `dependsOn` field from
  // the one form — the split is a render-time partition, not a second
  // control.
  test("every chip in both halves posts the same dependsOn field from the one trackingform", () => {
    const html = withOptions(["164-a-spec-can-depend"]);
    const formStart = html.indexOf('<form class="trackingform"');
    const formEnd = html.indexOf("</form>", formStart);
    const form = html.slice(formStart, formEnd);
    const boxes = [...form.matchAll(/<input[^>]*name="dependsOn"[^>]*>/g)].map((m) => m[0]);
    expect(boxes).toHaveLength(2);
    expect(html.match(/<form class="trackingform"/g)?.length).toBe(1);
  });

  // REQ-4: a spec with nothing ticked shows no picked block at all.
  // The box is always drawn, empty when nothing is picked: the word
  // "none" in its place left the browser's own lift with nothing to
  // move a chip into, so ticking a box did nothing until the form was
  // saved. `none` is a sibling the CSS hides once the box has a chip.
  test("the picked box is drawn empty, with none beside it, when nothing is picked", () => {
    const html = withOptions([]);
    expect(html).toContain('class="phases picked"></span>');
    expect(html).toContain("data-none");
  });
});

describe("the tracking form's Save/Cancel ride on the Depends on label line", () => {
  const OPTIONS = [
    { project: "aide", specFolder: "164-a-spec-can-depend" },
    { project: "aide", specFolder: "09-ninth" },
  ];

  // The pair belongs to the picker it saves, so it sits at the end of
  // that field's own label line — after the "(?)" — not under a list
  // tall enough to push it away from what it is about.
  test("the pair sits inside the field's label line, after the (?), ahead of the chips", () => {
    const html = page(view({ dependsOnOptions: OPTIONS, dependsOn: [] }));
    const headIdx = html.indexOf('class="fieldhead"');
    const endIdx = html.indexOf('class="fieldend"');
    const saveIdx = html.indexOf('id="trackingform-save"');
    const helpIdx = html.indexOf("what a dependency does");
    const pickedIdx = html.indexOf('class="phases picked"');
    expect(headIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(headIdx);
    expect(helpIdx).toBeLessThan(saveIdx);
    expect(saveIdx).toBeLessThan(pickedIdx);
  });

  // One pair, not two: it moved, it was not copied.
  test("the form draws exactly one Save and one Cancel", () => {
    const html = page(view({ dependsOnOptions: OPTIONS, dependsOn: [] }));
    expect(html.match(/id="trackingform-save"/g)?.length).toBe(1);
    expect(html.match(/id="trackingform-cancel"/g)?.length).toBe(1);
  });

  // A spec with nothing to depend on draws no picker at all, and the
  // acceptance switch beside it still has to be savable.
  test("a spec with no picker keeps the pair below the acceptance switch", () => {
    const html = page(view({ dependsOnOptions: [], dependsOn: [] }));
    expect(html).not.toContain('name="dependsOn"');
    const acceptIdx = html.indexOf("acceptance ticking not required");
    const saveIdx = html.indexOf('id="trackingform-save"');
    expect(saveIdx).toBeGreaterThan(acceptIdx);
  });

  // An archived spec is a record with no form: no pair to draw.
  test("an archived spec has no Save at all", () => {
    const html = page(view({ archived: true, dependsOnOptions: OPTIONS, dependsOn: ["09-ninth"] }));
    expect(html).not.toContain('id="trackingform-save"');
  });
});

// The switch says what it means, and the locked one says which way it
// actually went. It used to draw the words "acceptance ticking not
// required" either way once `analyze` had locked it — so a spec that
// DOES require its ticking was told, in plain words, that it does not.
describe("the acceptance switch says what was decided", () => {
  test("a spec that requires ticking draws a ticked box, in the positive words", () => {
    const html = page(view({ acceptanceNotRequired: false }));
    expect(html).toContain("acceptance ticking required");
    expect(html).not.toContain("acceptance ticking not required");
    expect(html).toMatch(/name="acceptanceRequired"[^>]*checked/);
  });

  test("a spec that does not draws the same box, cleared", () => {
    const html = page(view({ acceptanceNotRequired: true }));
    const box = html.match(/<input type="checkbox"[^>]*name="acceptanceRequired"[^>]*>/)?.[0] ?? "";
    expect(box).not.toBe("");
    expect(box).not.toContain("checked");
  });

  // Locked once analyze has decided — but still a box, and still ticked
  // according to what it decided.
  test("locked, it is disabled and still says which way it went", () => {
    const required = page(view({ done: ["analyze"], acceptanceNotRequired: false }));
    expect(required).toContain("acceptance ticking required");
    expect(required).toMatch(/<input type="checkbox" disabled checked>/);
    const not = page(view({ done: ["analyze"], acceptanceNotRequired: true }));
    expect(not).toMatch(/<input type="checkbox" disabled>/);
  });

  // A locked box submits nothing, exactly as a cleared one does —
  // `acceptanceEditable` is the hidden sentinel that tells them apart.
  test("a locked switch posts no field of its own", () => {
    const html = page(view({ done: ["analyze"], acceptanceNotRequired: false }));
    expect(html).not.toContain('name="acceptanceRequired"');
    expect(html).not.toContain('name="acceptanceEditable"');
  });
});
