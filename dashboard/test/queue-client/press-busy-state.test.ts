import { describe, expect, test } from "bun:test";
import { SPINNER } from "../../src/render/ui/components.ts";
import {
  SOURCE,
  CONTROLS,
  harness,
  swapUrl,
} from "./fixtures.ts";

// --- spec 104: a pressed button keeps its width -----------------------------

// The press used to rewrite the button's word — "Run" became "starting…",
// "Cancel" became "cancelling…" — and the button grew or shrank to fit,
// which shoved the whole row sideways at the one moment it should look
// most in control. It says the same thing by changing its LOOK instead,
// to the busy variant the server already renders for a job in flight,
// and the spinner takes the space the phase boxes were using: they are
// idle while a press is out, and they come back with the next render.
describe("a pressed row button holds its size (spec 104)", () => {
  const OK = { ok: true, job: { id: "job-1" } };

  for (const control of ["rowrun", "actionform"] as const) {
    test(`${control} swaps to the busy look without changing its label`, async () => {
      const { label, variant } = CONTROLS[control]!;
      let seen = { label: "", busy: false, variant: true, spinner: "" };
      const h = harness(
        (url) => {
          if (url.includes("/api/queue")) {
            seen = {
              label: h.button.textContent,
              busy: h.button.classList.contains("busy"),
              variant: h.button.classList.contains(variant),
              spinner: h.button.innerHTML,
            };
          }
          return { ok: true, body: OK };
        },
        control,
      );
      await h.submit();
      // The word on the button is the word it had. Nothing that decides
      // the button's width changed, so the width could not.
      expect(seen.label).toBe(label);
      expect(seen.busy).toBe(true);
      // In PLACE of the variant, not beside it: two variants at once is
      // a button with two looks.
      expect(seen.variant).toBe(false);
      // ONE spinner per row, inside the button that was pressed: since
      // spec 124 the phase boxes are on lines of their own and have no
      // space to lend.
      expect(seen.spinner).toContain(SPINNER);
    });
  }

  // The pending word is not lost, only moved off the label: `title` is
  // where it costs no width. (A screen reader hears the press as the
  // button being disabled — see the spec's risk note.)
  test("the server's pending word rides along as the button's title", async () => {
    let seen = "";
    const h = harness((url) => {
      if (url.includes("/api/queue")) seen = h.button.title;
      return { ok: true, body: OK };
    }, "rowrun");
    await h.submit();
    expect(seen).toBe("starting…");
  });

  // Spec 124: there are no boxes to borrow any more — the phase boxes
  // are on the phase LINES, and every button on the row is on the
  // header. So the spinner goes where it always went on a collapsed
  // row: inside the button that was pressed, for every control alike.
  for (const control of ["rowrun", "actionform"] as const) {
    test(`${control} carries its own spinner, and asks no row for boxes`, async () => {
      let seen = { busy: false, spinner: "" };
      const h = harness((url) => {
        if (url.includes("/api/queue")) {
          seen = { busy: h.button.classList.contains("busy"), spinner: h.button.innerHTML };
        }
        return { ok: true, body: OK };
      }, control);
      await h.submit();
      expect(seen.busy).toBe(true);
      expect(seen.spinner).toContain(SPINNER);
      // The row is still asked for nothing at all: the "also touches"
      // chips now share the button's own `<tr>`, and a `.phases`
      // lookup would put the spinner in them.
      expect(h.rowQueries.filter((q) => q.includes("phases"))).toEqual([]);
    });
  }

  // The boxes are the Run form's own fields wherever they are drawn,
  // and the press must not disturb them: a spinner written over them
  // before the form is serialised posts a job with no phases at all.
  test("the phase boxes are left alone by a press", async () => {
    let seen = "";
    const h = harness((url) => {
      if (url.includes("/api/queue")) seen = h.phases.innerHTML;
      return { ok: true, body: OK };
    }, "rowrun");
    await h.submit();
    expect(seen).toContain('class="phase"');
    expect(h.phases.style.minWidth).toBe("");
    expect(String(h.requests[0]!.init.body)).toContain("steps=analyze");
  });

  // Nothing puts the boxes back by hand: every path out of a press ends
  // in the rows being re-asked from the server, which draws whatever is
  // true NOW — the boxes, or the busy chips of the job that just
  // started. Both halves of "success or refusal" go through it.
  test("the boxes come back with the server's own answer, on success", async () => {
    const h = harness(() => ({ ok: true, body: OK }), "rowrun");
    await h.submit();
    expect(swapUrl(h)).toContain("rows=1");
    expect(h.rows.innerHTML).toBe("<tr></tr>");
  });

  test("and on a refusal, which redraws the same way", async () => {
    const h = harness(
      (url) =>
        url.includes("rows=1")
          ? { ok: true }
          : { ok: false, body: { error: "analyze is already running", spec: "aide/104-x" } },
      "rowrun",
    );
    await h.submit();
    expect(swapUrl(h)).toContain("rows=1");
    expect(h.rows.innerHTML).toBe("<tr></tr>");
  });

  // The redraw is what puts the boxes back — but a redraw that fails
  // (server restarting, tailnet hiccup) leaves the row standing, and a
  // row left holding a spinner for something that is over is worse than
  // the shove this spec set out to fix.
  test("a redraw that never arrives puts the button back itself", async () => {
    const h = harness((url) => (url.includes("rows=1") ? { ok: false } : { ok: true, body: OK }), "rowrun");
    await h.submit();
    expect(h.rows.innerHTML).toBe("");
    expect(h.button.textContent).toBe("Run");
    expect(h.button.classList.contains("busy")).toBe(false);
    expect(h.button.classList.contains("primary")).toBe(true);
  });

  // One runs server-side (`components.ts`) and the other is bundled for
  // the browser (`queue-client/press.ts`), so the spinner is a
  // hand-copied literal on each side. Checked against the bundled
  // SOURCE rather than the raw entry file: the literal itself lives in
  // one of the split files, not in queue-client.ts.
  test("the spinner it writes is the one components.ts renders", () => {
    expect(SOURCE).toContain(SPINNER);
  });
});

// --- spec 151: a press locks the row -----------------------------------------
//
// Seen 2026-08-21: Run was pressed, nothing on the row changed, so it
// was pressed again — and the second press was refused because the
// first had already started the job. The first press worked; the row
// never said so.
//
// Two things were wrong, and the second is why the first went
// unnoticed for so long. The Run button is written OUTSIDE its form
// and tied to it by `form="…"`, so `form.querySelectorAll("button")`
// — descendants only — found nothing to lock or to make busy. And the
// harness above used to hard-code `() => [button]` for every form,
// asserting by construction the very thing the markup breaks.
//
// The requirement is wider than the bug: a press locks EVERY control
// on that row at once — its own button, the other buttons in the
// stack, the phase boxes and the model/AI selects on the phase lines
// — and nothing is unlocked until the row has been redrawn from the
// server.
describe("a press locks every control on its row (spec 151)", () => {
  const OK = { ok: true, job: { id: "job-1" } };
  /** Every control the row has, as the press must leave them. */
  const rowState = (h: ReturnType<typeof harness>) => ({
    run: h.runButton.disabled,
    cancel: h.cancelButton.disabled,
    box: h.stepBoxes[0]!.disabled,
    model: h.modelSelects[0]!.disabled,
    ai: h.aiSelects[0]!.disabled,
    otherRow: h.otherRowSelect.disabled,
  });

  for (const control of ["rowrun", "actionform"] as const) {
    test(`${control} locks the whole row, and only its own row`, async () => {
      let seen = {} as ReturnType<typeof rowState>;
      const h = harness((url) => {
        if (url.includes("/api/queue")) seen = rowState(h);
        return { ok: true, body: OK };
      }, control);
      await h.submit();
      expect(seen).toEqual({
        run: true, cancel: true, box: true, model: true, ai: true,
        // The other row's select names another form. A press that
        // reached it would grey out a spec nobody touched.
        otherRow: false,
      });
    });
  }

  // The bug itself, stated as its own case: Run's button is not a
  // descendant of the form it submits, so the old descendants-only
  // lookup could neither disable it nor make it busy.
  test("Run is locked and busy although its button sits outside its form", async () => {
    let seen = { disabled: false, busy: false, title: "" };
    const h = harness((url) => {
      if (url.includes("/api/queue")) {
        seen = {
          disabled: h.runButton.disabled,
          busy: h.runButton.classList.contains("busy"),
          title: h.runButton.title,
        };
      }
      return { ok: true, body: OK };
    }, "rowrun");
    await h.submit();
    expect(seen).toEqual({ disabled: true, busy: true, title: "starting…" });
  });

  // The busy LOOK belongs to the button that was pressed. The stack is
  // locked whole, but Run is first in it — so a spinner taken from the
  // stack instead of from the submitted form would land on Run for
  // every press that was not Run's.
  test("the busy look stays on the pressed button, and Run is only greyed", async () => {
    let seen = { cancel: false, run: false, spinner: "" };
    const h = harness((url) => {
      if (url.includes("/api/queue")) {
        seen = {
          cancel: h.button.classList.contains("busy"),
          run: h.runButton.classList.contains("busy"),
          spinner: h.runButton.innerHTML,
        };
      }
      return { ok: true, body: OK };
    }, "actionform");
    await h.submit();
    expect(seen).toEqual({ cancel: true, run: false, spinner: "" });
  });

  // Not "until the answer arrives" — until the row that reflects it is
  // on the screen. The redraw is asked for while everything is still
  // locked.
  test("the row is still locked when the redraw is asked for", async () => {
    let seen = {} as ReturnType<typeof rowState>;
    const h = harness((url) => {
      if (url.includes("rows=1")) seen = rowState(h);
      return { ok: true, body: OK };
    }, "rowrun");
    await h.submit();
    expect(seen.run).toBe(true);
    expect(seen.box).toBe(true);
  });

  // The lock comes AFTER the form has been serialised. A disabled
  // control posts nothing, so locking the boxes first would queue a
  // job with no phases at all — the row's own fields, thrown away by
  // the thing meant to protect them.
  test("the phases still go with the press, although the boxes lock", async () => {
    const h = harness(() => ({ ok: true, body: OK }), "rowrun");
    await h.submit();
    expect(String(h.requests[0]!.init.body)).toContain("steps=analyze");
  });

  // Every control goes back to the state it was FOUND in, not to
  // "enabled": the server draws a row's boxes disabled while a job
  // holds them, and a press that put them back live would offer a
  // choice the server has already refused.
  test("a press that could not be sent puts back exactly what it locked", async () => {
    const h = harness(() => ({ ok: false, throws: true }), "actionform");
    h.stepBoxes[1]!.disabled = true;
    await h.submit();
    expect(rowState(h)).toEqual({
      run: false, cancel: false, box: false, model: false, ai: false, otherRow: false,
    });
    expect(h.stepBoxes[1]!.disabled).toBe(true);
  });

  // A SHUT row used to be the case with no scope at all: it drew its
  // one control in the header's last cell, that control's button was
  // inside its own form, and `td.stackcell` — an open row's cell —
  // found nothing. Spec 157 draws every row's control in the head row,
  // open or shut, so a shut row's press locks exactly what an open
  // one's does. Nothing is left that has a row and no scope.
  test("a shut row's control locks the whole row too (spec 157)", async () => {
    let seen = {} as ReturnType<typeof rowState>;
    const h = harness((url) => {
      if (url.includes("/api/queue")) seen = rowState(h);
      return { ok: true, body: OK };
    }, "actionform");
    await h.submit();
    expect(seen).toEqual({
      run: true, cancel: true, box: true, model: true, ai: true, otherRow: false,
    });
    expect(h.button.disabled).toBe(false);
    expect(h.button.classList.contains("busy")).toBe(false);
  });

  // What the fallback describes now: a form on no spec row at all —
  // the New-spec page, the Projects panel. Its own button is inside
  // it, and there is nothing to widen the scope to.
  test("a form on no spec row locks its own button and nothing else", async () => {
    let seen = { busy: false, disabled: false, run: false };
    const h = harness(
      (url) => {
        if (url.includes("/api/queue")) {
          seen = {
            busy: h.button.classList.contains("busy"),
            disabled: h.button.disabled,
            run: h.runButton.disabled,
          };
        }
        return { ok: true, body: OK };
      },
      "actionform",
      "",
      { offRow: true },
    );
    await h.submit();
    expect(seen).toEqual({ busy: true, disabled: true, run: false });
    expect(h.button.disabled).toBe(false);
    expect(h.button.classList.contains("busy")).toBe(false);
  });

  // Spec 157, criteria 9 and 11. The row's one button sits inside
  // `tr.spechead` now, and the fold's chevron is a `<a data-nav>` on
  // the same delegated listener. A press must RUN, never open the row
  // underneath the request — and it cannot, structurally: `navigate`
  // acts only on `closest("a[data-nav]")`, which a `<button>` does not
  // match. Asserted rather than assumed, since nothing in the markup
  // says so.
  for (const control of ["rowrun", "actionform"] as const) {
    test(`a press on ${control} does not fold the row open or shut`, () => {
      const h = harness(() => ({ ok: true, body: OK }), control);
      h.click();
      // No history rewrite, so no `?open=` was added or taken away —
      // and no row swap was asked for on the click's own account.
      expect(h.replaced).toEqual([]);
      expect(h.requests).toEqual([]);
    });
  }

  // The control case: the chevron on the SAME listener still folds.
  // Without this the three above would pass just as happily against a
  // listener that had stopped answering clicks at all.
  test("the fold's own chevron still navigates", () => {
    const h = harness(() => ({ ok: true, body: OK }), "rowrun");
    h.clickFold();
    expect(h.replaced).toEqual(["/?open=aide%2F127-one-ai"]);
  });
});
