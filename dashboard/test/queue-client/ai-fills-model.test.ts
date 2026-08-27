// Split out of model-and-phase-picks.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  harness,
  flush,
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
