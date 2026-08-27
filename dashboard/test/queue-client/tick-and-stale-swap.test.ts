// Split out of model-and-phase-picks.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  harness,
  flush,
  OK_ACTION,
} from "./fixtures.ts";

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
