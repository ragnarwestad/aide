import { describe, expect, test } from "bun:test";
import {
  harness,
  flush,
  OK_ACTION,
} from "./fixtures.ts";

// --- spec 169: one action sets every phase still ahead ----------------------

// The row's AI select is gone. It posted nothing and chose nothing: all
// it did was hide the other tool's models from the five phase selects,
// which is exactly what stopped anyone discovering that a row CAN run
// analyze on one CLI and implement on another.
//
// What takes its slot is the convenience the filter was really standing
// in for — one action instead of five — done the way round that does
// not take anything away: it WRITES the five selects rather than
// hiding half of each.
//
// It writes only the phases still AHEAD. A phase that has run shows
// what it ran on, which is history rather than a suggestion, and the
// server marks those selects `data-ran="1"` so the two can never
// disagree about where the tail starts.
describe("an AI picked on a phase line fills that phase's model (spec 179)", () => {
  const values = (h: ReturnType<typeof harness>) => h.modelSelects.map((s) => s.value);
  const tools = (h: ReturnType<typeof harness>) => h.aiSelects.map((s) => s.value);

  test("nothing is written until the reader picks an AI", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    expect(values(h)).toEqual(["sonnet", "fable", "codex-fast", "sonnet"]);
    expect(tools(h)).toEqual(["claude", "claude", "codex", "claude"]);
  });

  // The value written is the one the SERVER worked out and put on the
  // option (`data-default`). Which model an AI stands for is a
  // configuration fact, and the browser copies it rather than deciding
  // between the tool's models itself.
  test("picking an AI writes that phase's model, and no other phase's", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeAi(1, "codex"); // analyze
    expect(values(h)).toEqual(["sonnet", "codex-fast", "codex-fast", "sonnet"]);
  });

  // A phase that has RUN is no exception. The removed set-all control
  // left it alone because one action wrote five selects and could not
  // ask; this is the reader picking on that line, and a rerun on
  // another AI is exactly what the line is for.
  test("a phase with history is written like any other", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeAi(1, "codex"); // analyze, which carries data-ran="1"
    expect(values(h)[1]).toBe("codex-fast");
  });

  test("picking Claude Code fills a Claude model in just as well", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeAi(2, "claude"); // implement, drawn on codex-fast
    expect(values(h)).toEqual(["sonnet", "fable", "sonnet", "sonnet"]);
  });

  // What the picker is FOR, and what it did not do until now: the list
  // beside it follows the tool. The models of the other CLI are still
  // in the markup — the server draws them all, so a reader with no
  // script keeps the whole list — but this select stops offering them,
  // and disables them so a post cannot carry one either.
  test("the phase's model list is narrowed to the AI that was picked", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    const implement = h.modelSelects.find((s) => s.name === "model.implement")!;
    h.changeAi(2, "claude");
    for (const o of implement.options) {
      const claude = o.dataset.tool === "claude";
      expect([o.value, o.hidden, o.disabled]).toEqual([o.value, !claude, !claude]);
    }
    // Back the other way, on the same line.
    h.changeAi(2, "codex");
    for (const o of implement.options) {
      const codex = o.dataset.tool === "codex";
      expect([o.value, o.hidden, o.disabled]).toEqual([o.value, !codex, !codex]);
    }
  });

  // Per PHASE LINE, never across the row: spec 169's filter was
  // row-wide and hid that a spec can run analyze on one CLI and
  // implement on another. Narrowing one line must leave the others as
  // they were.
  test("narrowing one phase leaves the other phases offering their own", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeAi(2, "codex");
    const analyze = h.modelSelects.find((s) => s.name === "model.analyze")!;
    expect(analyze.options.filter((o) => o.dataset.tool === "claude").every((o) => !o.hidden)).toBe(
      true,
    );
  });

  // The pairing is `data-ai` plus the shared form id, because the
  // selects are written outside the form's own tags and tied to it by
  // that attribute alone — the row is not a container that holds them.
  test("another row's model select is left alone", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeAi(1, "codex");
    expect(h.otherRowSelect.value).toBe("fable");
  });

  // Delegated on #jobrows, like every other control on the table: the
  // rows are replaced wholesale every five seconds, and a listener
  // bound to the select itself would last exactly one tick.
  test("it answers a change on the container, and ignores every other one", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeOther();
    expect(values(h)).toEqual(["sonnet", "fable", "codex-fast", "sonnet"]);
    h.changeAi(0, "codex");
    expect(values(h)[0]).toBe("codex-fast");
  });

  // Setting `.value` from script fires no `change` event, so the
  // per-select "remember what a hand touched" map is not written by the
  // browser on this path — `applyAiPick` has to write it itself.
  // Without that, the five-second swap puts the server's markup back
  // and the phase this just set silently reverts, with a press
  // afterwards starting the step on a model nobody chose.
  test("what an AI pick wrote survives the five-second swap", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    await h.changeAi(1, "codex");
    h.document.visibilityState = "visible";
    h.tick();
    await flush();

    expect(h.rows.innerHTML).toBe("<tr>fresh</tr>");
    expect(values(h)).toEqual(["sonnet", "codex-fast", "codex-fast", "sonnet"]);
    // And the AI select the swap just redrew says the same thing the
    // model select does. It carries no memory of its own — it is set
    // from the model that was restored, which is what keeps the two
    // from ever disagreeing.
    expect(tools(h)).toEqual(["claude", "codex", "codex", "claude"]);
  });

  test("a chosen MODEL survives it too, and an untouched one is the server's", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    // One phase moved by hand; the other four left exactly as drawn.
    await h.changeModel(1, "sonnet");
    h.document.visibilityState = "visible";
    h.tick();
    await flush();

    expect(values(h)).toEqual(["sonnet", "sonnet", "codex-fast", "sonnet"]);
  });

  // The tool is DERIVED from the model, in both directions of travel:
  // a reader who goes straight to the model select, ignoring the AI
  // picker beside it, must not be left with a line that says Claude
  // Code over a Codex model until the next swap comes to fix it.
  test("changing the model by hand moves its own AI select at once", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeModel(0, "codex-fast");
    expect(tools(h)).toEqual(["codex", "claude", "codex", "claude"]);
    h.changeModel(2, "fable");
    expect(tools(h)).toEqual(["codex", "claude", "claude", "claude"]);
  });

  test("a swap nobody has touched a select on is left to the server", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    h.document.visibilityState = "visible";
    h.tick();
    await flush();

    // The point of restoring only what a hand moved: a phase that has
    // RUN shows the model it ran on, and the swap is what delivers it.
    expect(values(h)).toEqual(["sonnet", "fable", "codex-fast", "sonnet"]);
    expect(tools(h)).toEqual(["claude", "claude", "codex", "claude"]);
  });

  // The AI select has no `name`, so the generic "remember every select"
  // branch would file every one of them under the same key — the form
  // id and an empty string — and the last one touched would decide the
  // lot. It is intercepted before that branch, and nothing about it is
  // remembered at all.
  test("the AI select is not filed in the map the model selects use", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    await h.changeAi(1, "codex");
    h.document.visibilityState = "visible";
    h.tick();
    await flush();

    // Only analyze moved. Had the AI select been remembered under the
    // shared key, the restore would have written it across the row.
    expect(values(h)).toEqual(["sonnet", "codex-fast", "codex-fast", "sonnet"]);
  });
});

describe("the Create spec AI choice fills its model (spec 228)", () => {
  test("the form's own change listener applies the paired model", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeCreateAi(0, "codex");
    expect(h.modelSelects[0]!.value).toBe("codex-fast");
  });
});

// --- spec 141: the phase boxes survive the swap too --------------------------
//
// The 2026-08-20 fix above covered the row's SELECTS. The boxes beside
// them were left out, and they are what a press actually runs: tick
// implement and archive, wait six seconds, press Run — and the job
// started whatever the server had ticked, without a word. The server
// re-derives its ticks from the row's history (`preTicked`) on every
// render, so a swap is not a no-op for them; it is an overwrite.
describe("a hand-ticked phase box survives the five-second swap (spec 141)", () => {
  const ticks = (h: ReturnType<typeof harness>) => h.stepBoxes.map((b) => b.checked);

  const swap = async (h: ReturnType<typeof harness>) => {
    h.document.visibilityState = "visible";
    h.tick();
    await flush();
  };

  // The button says what a press would run, and a press runs the BOXES
  // — so the label has to follow them as they are clicked. The server
  // names it from `preTicked`, its own suggestion, which is right for
  // the row as drawn and wrong the moment a reader ticks something
  // else: on 2026-08-21 spec 162, with analyze suggested and only
  // `archive` ticked by hand, went on offering "Analyze". The press was
  // correct — an open row posts its boxes and no hidden steps — but the
  // row said one thing and did another.
  test("the button names the first ticked phase as the boxes are clicked", () => {
    const h = harness(() => ({ ok: true }));
    expect(h.runButton.textContent).toBe("Run");

    h.changeStep(2, true); // archive on as well — analyze is still first
    expect(h.runButton.textContent).toBe("Analyze");

    h.changeStep(0, false); // analyze off — archive is first now
    expect(h.runButton.textContent).toBe("Archive");

    h.changeStep(2, false); // and off — nothing ticked at all
    expect(h.runButton.hidden).toBe(true);

    h.changeStep(1, true); // implement alone
    expect(h.runButton.hidden).toBe(false);
    expect(h.runButton.textContent).toBe("Implement");
  });

  test("a box the reader ticked is still ticked after the swap", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    h.changeStep(1, true); // implement
    h.changeStep(2, true); // archive
    await swap(h);

    expect(h.rows.innerHTML).toBe("<tr>fresh</tr>");
    expect(ticks(h)).toEqual([true, true, true]);
  });

  // A hand-made "off" is as much a choice as a hand-made "on": the
  // server had this one ticked, and the reader said no to it.
  test("a box the reader unticked stays unticked", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    h.changeStep(0, false); // analyze, which the server pre-ticked
    await swap(h);

    expect(ticks(h)).toEqual([false, false, false]);
  });

  test("a row nobody has touched keeps the ticks the server drew", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    await swap(h);

    expect(ticks(h)).toEqual([true, false, false]);
  });

  // The boxes share one `name`, so a key built the way a select's is
  // would file all three under `form|steps` and the last tick would
  // decide the lot.
  test("each box is remembered on its own, not one answer for the row", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    h.changeStep(0, false); // analyze off
    h.changeStep(2, true); // archive on
    await swap(h);

    expect(ticks(h)).toEqual([false, false, true]);
  });

  // The two maps must not spill into each other: a tick is not a value
  // the model selects can be restored from, and vice versa.
  test("ticking a box leaves the row's selects to the server", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    h.changeStep(1, true);
    await swap(h);

    expect(h.aiSelects.map((s) => s.value)).toEqual([
      "claude", "claude", "codex", "claude",
    ]);
    expect(h.modelSelects.map((s) => s.value)).toEqual([
      "sonnet", "fable", "codex-fast", "sonnet",
    ]);
  });
});

// --- spec 129: an answer older than the press never lands on top of it -------
//
// `inFlight` stops a NEW swap from STARTING while a press runs. It says
// nothing about one that was already in the air when the press began:
// that request carries the server's answer from BEFORE the press, and
// on resolving wrote it straight into `#jobrows` — over the busy button
// the press had just drawn, or over the refusal banner it had just
// asked for.
//
// The window is wide, not theoretical. Every `/?rows=1` answer waits on
// `isMerged()` for every branch of every listed job, and a cache miss
// there costs up to three sequential git calls at four seconds each —
// which is the 10-15 seconds of a pressed button sitting unchanged that
// was measured on 2026-08-20 (on the Merge button, which spec 149 later
// removed; the window it measured belongs to every control alike).
describe("a swap older than the press is discarded, not applied (spec 129)", () => {
  /** What the server said BEFORE the press, and what must never reach
   *  the page after it. */
  const STALE = "<tr>before the press</tr>";
  /** What it says once the press is accounted for. */
  const FRESH = "<tr>after the press</tr>";

  test("a tick's answer arriving mid-press does not put the untouched row back", async () => {
    let releaseTick: () => void = () => {};
    const tickHeld = new Promise<void>((r) => (releaseTick = r));
    let releasePress: () => void = () => {};
    const pressHeld = new Promise<void>((r) => (releasePress = r));
    const h = harness((url) =>
      url.includes("/cancel")
        ? { ok: true, body: OK_ACTION, hold: pressHeld }
        : { ok: true, text: STALE, hold: tickHeld },
    );
    h.document.visibilityState = "visible";
    // The tick goes first and its answer is held open — nothing about
    // this request will ever know a press happened.
    h.tick();
    await Promise.resolve();
    expect(h.requests.filter((r) => r.url.includes("rows=1"))).toHaveLength(1);
    // Then the press, while that request is still in the air.
    const pressed = h.submit();
    await Promise.resolve();
    expect(h.button.classList.contains("busy")).toBe(true);
    // Now the tick answers, with the row exactly as it was before.
    releaseTick();
    await flush();
    // Writing that into #jobrows is what replaced the busy button with
    // the untouched one the server still believed in.
    expect(h.rows.innerHTML).toBe("");
    expect(h.button.classList.contains("busy")).toBe(true);
    releasePress();
    await pressed;
  });

  test("a tick's answer arriving after a refusal does not wipe the reason", async () => {
    let releaseTick: () => void = () => {};
    const tickHeld = new Promise<void>((r) => (releaseTick = r));
    const REFUSED = {
      ok: false,
      spec: "aide/129-the-merge-button-answers-the-press",
      error: "cannot fast-forward main in /repos/aide — resolve it first",
    };
    const h = harness((url) => {
      if (url.includes("/cancel")) return { ok: true, body: REFUSED };
      // The refusal's OWN swap asks with the reason in the query
      // string (`showRefusal` put it there): that answer is the current
      // one, and it is the one that must survive.
      if (url.includes("errorSpec")) return { ok: true, text: FRESH };
      return { ok: true, text: STALE, hold: tickHeld };
    });
    h.document.visibilityState = "visible";
    h.tick();
    await Promise.resolve();
    await h.submit();
    expect(h.rows.innerHTML).toBe(FRESH);
    // The tick finally answers — from before the press was even made.
    releaseTick();
    await flush();
    expect(h.rows.innerHTML).toBe(FRESH);
  });

  // The guard must discard a STALE answer and nothing else: a tick that
  // raced nobody still has to redraw the table, which is the whole
  // reason the tick exists.
  test("with no press racing it, the tick's answer lands as it always did", async () => {
    const h = harness(() => ({ ok: true, text: STALE }));
    h.document.visibilityState = "visible";
    h.tick();
    await flush();
    expect(h.rows.innerHTML).toBe(STALE);
  });
});

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
