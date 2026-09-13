// Split out of model-and-phase-picks.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  harness,
} from "./fixtures.ts";

// --- spec 225: a live model pick posts itself ---------------------------------

// The same reasoning the tail box's tick rests on, applied to the two
// selects beside it. A busy row has no Run button to submit them with,
// and `/api/queue` would ask for a SECOND job — so a pick made on a
// phase the run has not reached goes to the running job's own route the
// moment it is made.
describe("a live model pick posts itself (spec 225)", () => {
  const OK = { ok: true, job: { id: "job-1" } };
  const LIVE = 3; // archive — the phase the running job has not reached
  const posts = (h: ReturnType<typeof harness>) =>
    h.requests.filter((r) => r.url.includes("/api/queue/job-1/model"));

  test("it posts the pick to the job's own route, not to /api/queue (criterion 4)", async () => {
    const h = harness(() => ({ ok: true, body: OK }));
    await h.changeModel(LIVE, "fable");
    const posted = posts(h)[0]!;
    expect(posted.init.method).toBe("POST");
    expect(String(posted.init.body)).toContain("step=archive");
    expect(String(posted.init.body)).toContain("model=fable");
    // The token rides in the query string, as every other press does.
    expect(posted.url).toContain("token=s3cret");
    // And never the create route.
    expect(h.requests.some((r) => r.url.endsWith("/api/queue"))).toBe(false);
  });

  // Criterion 5. `applyAiPick` deliberately fires no `change` event —
  // it writes the model select's value and records it. On a live line
  // that would leave the row showing an AI the running job knows
  // nothing about, so the pick has to reach the same route by hand.
  test("a picked AI posts the model it just wrote (criterion 5)", async () => {
    const h = harness(() => ({ ok: true, body: OK }));
    await h.changeAi(LIVE, "codex");
    const posted = posts(h)[0]!;
    expect(posted).toBeDefined();
    expect(String(posted.init.body)).toContain("step=archive");
    // The value the SERVER worked out for that AI, carried on the
    // option — the browser copies it and never decides one.
    expect(String(posted.init.body)).toContain("model=codex-fast");
    expect(h.modelSelects[LIVE]!.value).toBe("codex-fast");
  });

  // The line that is NOT live is unchanged: its pick is remembered for
  // the next Run and reaches no route at all.
  test("a dormant phase's pick is still only remembered", async () => {
    const h = harness(() => ({ ok: true, body: OK }));
    await h.changeModel(1, "sonnet");
    expect(posts(h)).toHaveLength(0);
    await h.changeAi(1, "codex");
    expect(posts(h)).toHaveLength(0);
  });

  // Spec 151's rule, applied to a select: the whole row locks the
  // instant the pick lands, and stays locked until it has been redrawn
  // from the server's own answer.
  test("the row locks at once and is redrawn from the answer", async () => {
    let atRequest = { run: false, box: false, model: false, otherRow: false };
    const h = harness((url) => {
      if (url.includes("/api/queue/job-1/model")) {
        atRequest = {
          run: h.runButton.disabled,
          box: h.stepBoxes[0]!.disabled,
          model: h.modelSelects[LIVE]!.disabled,
          otherRow: h.otherRowSelect.disabled,
        };
      }
      return { ok: true, body: OK };
    });
    await h.changeModel(LIVE, "fable");
    expect(atRequest).toEqual({ run: true, box: true, model: true, otherRow: false });
    expect(h.rows.innerHTML).not.toBe("");
    expect(h.modelSelects[LIVE]!.disabled).toBe(false);
  });

  // An accepted pick is not in the markup the server draws back — the
  // select is pre-filled from the phase's own history, and a phase
  // still ahead has none — so it is remembered the same way a pick for
  // the next Run is, and the swap puts it back.
  test("an accepted pick survives the redraw that follows it", async () => {
    const h = harness(() => ({ ok: true, body: OK }));
    await h.changeModel(LIVE, "fable");
    expect(h.modelSelects[LIVE]!.value).toBe("fable");
  });

  // A refusal has to be visible: the select showed a model the running
  // job is not on, and the server did not take it.
  test("a refused pick is dropped, and the reason is shown", async () => {
    const h = harness((url) =>
      url.includes("/api/queue/job-1/model")
        ? { ok: false, body: { error: "archive is not a step this run can still be given" } }
        : { ok: true },
    );
    await h.changeModel(LIVE, "fable");
    expect(h.replaced.join("")).toContain(encodeURIComponent("not a step this run can still be given"));
    // Not remembered either: the swap put the server's own value back,
    // and nothing replays the refused one over it.
    expect(h.modelSelects[LIVE]!.value).toBe("sonnet");
    expect(h.modelSelects[LIVE]!.disabled).toBe(false);
    expect(h.runButton.disabled).toBe(false);
  });

  test("a request that cannot be sent reloads the page, as every other press does", async () => {
    const h = harness(() => ({ ok: false, throws: true }));
    await h.changeModel(LIVE, "fable");
    expect(h.location.href).toBe("/");
  });
});
