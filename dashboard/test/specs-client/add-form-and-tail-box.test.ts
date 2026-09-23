// Split out of model-and-phase-picks.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  harness,
} from "./fixtures.ts";

// --- spec 138: a successful Add has something to say -------------------------
//
// The answer the server worked out — whether a run can start in the
// project just added, and every reason it cannot — must reach the
// reader. It was thrown away once (Skjer, 2026-08-20: added, looked
// added, and the reasons it could not run were in a response body
// nobody ever saw), and the fix then was to keep the page put.
//
// Since 2026-09-23 the page goes to the list instead, and the answer
// rides with it in the query string — the same way it already reached a
// browser with no script. Staying left Save live under a line saying it
// worked, offering to add the same project a second time.
describe("a successful Add goes to the list, and takes its answer along", () => {
  const READY = {
    ok: true,
    project: "skjer",
    results: [{ step: "name", ok: true }],
    readiness: { canRun: true, note: "skjer added — ready to run", checks: [] },
  };
  const BLOCKED = {
    ok: true,
    project: "skjer",
    results: [{ step: "name", ok: true }],
    readiness: {
      canRun: false,
      note:
        "skjer added — cannot run yet: the tree at /repos/skjer is dirty (.aide/); " +
        "no specs root at /repos/skjer/specs",
      checks: [],
    },
  };

  test("every blocker in the answer travels to the list, uncoloured as a success", async () => {
    const h = harness(() => ({ ok: true, body: BLOCKED }));
    await h.submitAdd();
    const url = new URL(h.location.href, "http://dash.test");
    expect(url.pathname).toBe("/projects");
    expect(url.searchParams.get("notice")).toContain("cannot run yet");
    expect(url.searchParams.get("notice")).toContain(".aide/");
    expect(url.searchParams.get("notice")).toContain("/repos/skjer/specs");
    expect(url.searchParams.get("noticeOk")).toBe(null);
  });

  test("a project that CAN run says so, and says it in the ready colour", async () => {
    const h = harness(() => ({ ok: true, body: READY }));
    await h.submitAdd();
    const url = new URL(h.location.href, "http://dash.test");
    expect(url.pathname).toBe("/projects");
    expect(url.searchParams.get("notice")).toContain("ready to run");
    expect(url.searchParams.get("noticeOk")).toBe("1");
  });

  // A refusal is not a success: it stays on the form, where the fields
  // that fix it are.
  test("a refused Add stays on the form, with the reason beside it", async () => {
    const h = harness(() => ({ ok: false, body: { ok: false, results: [{ step: "name", error: "that name is taken" }] } }));
    await h.submitAdd();
    expect(h.addSlot.textContent).toContain("that name is taken");
    expect(h.location.href).toBe("http://dash.test/");
  });

  // A Remove carries no readiness — there is nothing to be ready — so it
  // returns to the list with nothing to say.
  test("a removal returns to the list with no notice on it", async () => {
    const h = harness(
      () => ({ ok: true, body: { ok: true, results: [{ step: "confirm", ok: true }] } }),
      "actionform",
      "",
      { pathname: "/projects" },
    );
    await h.submitRemove();
    expect(h.location.href).toBe("/projects");
  });
});

// --- spec 160: a tail box posts on its own -------------------------------------

// While a job runs, the boxes for phases it has not reached stay live.
// There is no Run button on a busy row to submit them with — the row
// shows Cancel — and posting to `/api/queue` would ask for a SECOND
// job, which the clash check refuses outright. So the tick is the
// press: it goes to the running job's own route, the moment it happens.
describe("a tail box's tick posts itself (spec 160)", () => {
  const OK = { ok: true, job: { id: "job-1" } };

  test("it posts the tick to the job's own route, not to /api/queue", async () => {
    const h = harness(() => ({ ok: true, body: OK }));
    await h.changeTail(true);
    const posted = h.requests.find((r) => r.url.includes("/steps"))!;
    expect(posted.url).toContain("/api/queue/job-1/steps");
    expect(posted.init.method).toBe("POST");
    expect(String(posted.init.body)).toContain("step=archive");
    expect(String(posted.init.body)).toContain("checked=1");
    // And never the create route.
    expect(h.requests.some((r) => r.url.endsWith("/api/queue"))).toBe(false);
  });

  test("unticking says so", async () => {
    const h = harness(() => ({ ok: true, body: OK }));
    await h.changeTail(false);
    expect(String(h.requests[0]!.init.body)).toContain("checked=0");
  });

  // Spec 151's rule, applied to a control that is not a button: the
  // whole row locks the instant the tick lands, and stays locked until
  // the row has been redrawn from the server's own answer.
  test("the row locks at once and is redrawn from the answer (criterion 7)", async () => {
    let atRequest = { run: false, box: false, tail: false, cancel: false, otherRow: false };
    let atRedraw = false;
    const h = harness((url) => {
      if (url.includes("/steps")) {
        atRequest = {
          run: h.runButton.disabled,
          box: h.stepBoxes[0]!.disabled,
          tail: h.tailBox.disabled,
          cancel: h.cancelButton.disabled,
          otherRow: h.otherRowSelect.disabled,
        };
      }
      if (url.includes("rows=1")) atRedraw = h.runButton.disabled;
      return { ok: true, body: OK };
    });
    await h.changeTail(true);
    expect(atRequest).toEqual({ run: true, box: true, tail: true, cancel: true, otherRow: false });
    // Still locked when the redraw is asked for — not merely until the
    // answer arrived.
    expect(atRedraw).toBe(true);
    expect(h.rows.innerHTML).not.toBe("");
    expect(h.runButton.disabled).toBe(false);
  });

  // A refusal has to be visible on the box itself: the tick showed the
  // step as added, and the server did not add it.
  test("a refused tick is put back, and the reason is shown (criterion 7)", async () => {
    let checkedWhenRedrawn: boolean | undefined;
    const h = harness((url) => {
      if (url.includes("/steps")) {
        return { ok: false, body: { error: "archive is not an editable step on this job" } };
      }
      if (url.includes("rows=1")) checkedWhenRedrawn = h.tailBox.checked;
      return { ok: true };
    });
    await h.changeTail(true);
    // Put back BEFORE the row is re-asked for, so a redraw that never
    // comes still leaves the box telling the truth.
    expect(checkedWhenRedrawn).toBe(false);
    expect(h.replaced.join("")).toContain(encodeURIComponent("not an editable step"));
    // And the row is live again.
    expect(h.tailBox.disabled).toBe(false);
    expect(h.runButton.disabled).toBe(false);
  });

  test("a request that cannot be sent reloads the page, as every other press does", async () => {
    const h = harness(() => ({ ok: false, throws: true }));
    await h.changeTail(true);
    expect(h.location.href).toBe("/");
  });
});
