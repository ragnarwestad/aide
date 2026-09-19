import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderNewSpecPage } from "../../../../src/render";

// The project select is `required`, so the browser stops Create at the
// field the way it does for the title and the description. happy-dom's
// `requestSubmit()` runs the form's validity check before it dispatches
// `submit`, and fires `invalid` on each failing control in form order.
describe("the New spec form requires a project at the field", () => {
  let win: Window | undefined;
  afterEach(async () => {
    await win?.happyDOM.close();
    win = undefined;
  });

  const load = () => {
    const html = renderNewSpecPage([{ label: "Overview", path: "projects.html" }], "2026-09-19T00:00:00Z", {
      createProjects: ["aide", "aide-dashboard"],
      targets: [],
    });
    win = new Window();
    win.document.write(html);
    const doc = win.document;
    const form = doc.querySelector("#new-spec-form") as unknown as HTMLFormElement;
    const project = form.querySelector('select[name="project"]') as unknown as HTMLSelectElement;
    const title = form.querySelector('input[name="title"]') as unknown as HTMLInputElement;
    const description = form.querySelector('textarea[name="description"]') as unknown as HTMLTextAreaElement;
    const invalid: string[] = [];
    for (const el of [project, title, description]) {
      el.addEventListener("invalid", () => invalid.push(el.name));
    }
    let submits = 0;
    form.addEventListener("submit", (e) => {
      submits++;
      e.preventDefault();
    });
    return { form, project, title, description, invalid, submits: () => submits };
  };

  test("the form is not sent while the project is missing (AC-1)", () => {
    const f = load();
    f.title.value = "A title";
    f.description.value = "A description";
    f.form.requestSubmit();
    expect(f.project.validity.valueMissing).toBe(true);
    expect(f.invalid).toEqual(["project"]);
    expect(f.submits()).toBe(0);
  });

  test("with everything empty the project is reported before title and description (AC-2)", () => {
    const f = load();
    f.form.requestSubmit();
    expect(f.invalid[0]).toBe("project");
    expect(f.submits()).toBe(0);
  });

  test("choosing a project makes the project valid and lets the form be sent (AC-3)", () => {
    const f = load();
    f.title.value = "A title";
    f.description.value = "A description";
    f.form.requestSubmit();
    expect(f.project.validity.valid).toBe(false);
    expect(f.submits()).toBe(0);
    f.project.value = "aide";
    expect(f.project.validity.valid).toBe(true);
    f.form.requestSubmit();
    expect(f.submits()).toBe(1);
  });
});
