// Split out of model-and-phase-picks.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  harness,
} from "./fixtures.ts";

// --- spec 138: a successful Add has something to say -------------------------
//
// The Add form used to navigate on success, exactly like Remove, and the
// answer went with it: the server had worked out whether a run could
// start in the project just added, and the browser threw that away in
// `location.href = "/projects"`. Skjer was added on 2026-08-20 and looked
// added; the reasons it could not run were in a response body nobody ever
// saw.
describe("the Add form keeps the readiness answer on screen", () => {
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

  // Criterion 11, the JavaScript half: every blocker in the answer, on
  // the page the reader pressed Save on — which is also the page whose
  // Specs root and Worktree links fields are what usually fix it.
  test("every blocker in the answer is written beside the form, and the page stays put", async () => {
    const h = harness(() => ({ ok: true, body: BLOCKED }));
    await h.submitAdd();
    expect(h.addSlot.textContent).toContain("cannot run yet");
    expect(h.addSlot.textContent).toContain(".aide/");
    expect(h.addSlot.textContent).toContain("/repos/skjer/specs");
    expect(h.addSlot.className).toBe("refused rowmsg warn");
    expect(h.location.href).toBe("http://dash.test/");
  });

  test("a project that CAN run says so, in the same place", async () => {
    const h = harness(() => ({ ok: true, body: READY }));
    await h.submitAdd();
    expect(h.addSlot.textContent).toContain("ready to run");
    // Not the colour of a refusal: the project can run.
    expect(h.addSlot.className).toBe("refused rowmsg info");
    expect(h.location.href).toBe("http://dash.test/");
  });

  // A Remove carries no readiness — there is nothing to be ready — so it
  // still returns to the list it changed.
  test("a removal still returns to the list, because it has no such answer", async () => {
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
    // The token rides in the query string, as every other press does.
    expect(posted.url).toContain("token=s3cret");
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
