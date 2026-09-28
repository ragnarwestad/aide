import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderNewSpecPage } from "../../../../src/render";

// Spec 553: Create moved onto the Project label's own head line, beside
// the word "Project" itself. The field stays a real `<label for="...">`
// rather than a plain `<span>` (`field()`'s `group` option) — the
// description promises every field keeps doing what it does today, and
// clicking a field's own label to reach its control is one of those
// things. The explicit `for` is what makes that possible with Create
// sharing the line: with no `for`, a browser resolves an unlabelled
// click to the label's first labelable DESCENDANT, which the head-first
// markup makes the Create button, not the `<select>` that follows it.
describe("the Project label still focuses its own picker with Create beside it (spec 553, AC-1)", () => {
  let win: Window | undefined;
  afterEach(async () => {
    await win?.happyDOM.close();
    win = undefined;
  });

  test("the label's own control resolves to the select, not the Create button", () => {
    const html = renderNewSpecPage([{ label: "Overview", path: "projects.html" }], "2026-09-27T00:00:00Z", {
      createProjects: ["aide"],
      targets: [],
    });
    win = new Window();
    win.document.write(html);
    const doc = win.document;
    const label = doc.querySelector('label[for="new-spec-project"]') as unknown as HTMLLabelElement;
    const select = doc.querySelector("#new-spec-project") as unknown as HTMLSelectElement;
    expect(label).not.toBeNull();
    expect(select).not.toBeNull();
    // `HTMLLabelElement.control` is the browser's own answer to "what
    // does a click on this label reach" — explicit `for` first, an
    // implicit labelable descendant only when there is none. With no
    // `for` this would resolve to the Create `<button>` instead, since
    // the head (and its button) is drawn before the control.
    expect(label.control).toBe(select);
  });
});
