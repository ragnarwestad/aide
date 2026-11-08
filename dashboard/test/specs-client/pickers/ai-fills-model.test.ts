// Split out of model-and-phase-picks.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { harness, flush } from "../fixtures.ts";
import { Window } from "happy-dom";
import { syncSidePickers } from "../../../src/specs-client/ai-sync.ts";

test("Review and Verify keep every configured model when Implement's tool changes (AC-2)", () => {
  const window = new Window();
  window.document.body.innerHTML = `<form id="f"></form>
    <select name="model.implement" form="f"><option value="sonnet" data-tool="claude">sonnet</option><option value="pickle" data-tool="opencode">pickle</option></select>
    <select name="model.review" form="f" data-side-picker><option value=""></option><option value="sonnet" data-tool="claude">sonnet</option><option value="codex" data-tool="codex">codex</option><option value="pickle" data-tool="opencode">pickle</option></select>`;
  const implement = window.document.querySelector(
    'select[name="model.implement"]',
  ) as unknown as HTMLSelectElement;
  const review = window.document.querySelector(
    'select[name="model.review"]',
  ) as unknown as HTMLSelectElement;
  const option = (value: string) =>
    Array.from(review.options).find((entry) => entry.value === value)!;

  syncSidePickers(window.document as unknown as ParentNode);
  for (const value of ["sonnet", "codex", "pickle"])
    expect(option(value).disabled).toBe(false);
  implement.value = "pickle";
  syncSidePickers(window.document as unknown as ParentNode, "f");
  for (const value of ["sonnet", "codex", "pickle"]) {
    expect([option(value).hidden, option(value).disabled]).toEqual([
      false,
      false,
    ]);
  }
});

// --- One action sets every phase still ahead ----------------------

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
describe("an AI picked on a phase line fills that phase's model", () => {
  const values = (h: ReturnType<typeof harness>) =>
    h.modelSelects.map((s) => s.value);
  const tools = (h: ReturnType<typeof harness>) =>
    h.aiSelects.map((s) => s.value);

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
      expect([o.value, o.hidden, o.disabled]).toEqual([
        o.value,
        !claude,
        !claude,
      ]);
    }
    // Back the other way, on the same line.
    h.changeAi(2, "codex");
    for (const o of implement.options) {
      const codex = o.dataset.tool === "codex";
      expect([o.value, o.hidden, o.disabled]).toEqual([
        o.value,
        !codex,
        !codex,
      ]);
    }
  });

  // Per PHASE LINE, never across the row: a row-wide filter
  // once hid that a spec can run analyze on one CLI and
  // implement on another. Narrowing one line must leave the others as
  // they were.
  test("narrowing one phase leaves the other phases offering their own", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeAi(2, "codex");
    const analyze = h.modelSelects.find((s) => s.name === "model.analyze")!;
    expect(
      analyze.options
        .filter((o) => o.dataset.tool === "claude")
        .every((o) => !o.hidden),
    ).toBe(true);
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

  // The provider picked is filed under its own name (`provider.<step>`)
  // next to the model, so the swap puts back the provider of the line that
  // was touched and no other.
  test("the provider picked is remembered for its own line only", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    await h.changeAi(1, "codex");
    h.document.visibilityState = "visible";
    h.tick();
    await flush();

    expect(values(h)).toEqual(["sonnet", "codex-fast", "codex-fast", "sonnet"]);
    expect(tools(h)).toEqual(["claude", "codex", "codex", "claude"]);
  });

  // Two providers of one tool run the same models: switching between
  // them keeps the model the line is on and posts the provider alone.
  test("switching between two providers of one tool keeps the model, and posts the provider (AC-9)", async () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    const analyze = h.aiSelects[1]!;
    analyze.options.push({
      value: "claude-2",
      dataset: { default: "sonnet", tool: "claude" },
      hidden: false,
      selected: false,
    });
    await h.changeAi(1, "claude-2");
    expect(values(h)[1]).toBe("fable");
    const posted = h.requests.filter((r) =>
      r.url.includes("/api/queue/specs/"),
    )[0]!;
    expect(String(posted.init.body)).toContain("provider=claude-2");
    expect(String(posted.init.body)).toContain("model=fable");
  });
});

describe("the Create spec AI choice fills its model", () => {
  test("the form's own change listener applies the paired model", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeCreateAi(0, "codex");
    expect(h.modelSelects[0]!.value).toBe("codex-fast");
  });
});

// --- A model picked for a phase survives leaving the page --------

// The dashboard has to remember a pick the instant it is made, not only
// for the rest of this tab's session (`chosen`) — so a non-live pick
// posts itself too, the way a live one already did (see
// `postTailModel`). `model.create` is the non-live select every other
// test in this file leaves untouched, so it doubles as "a phase nobody
// has picked for yet" here.
describe("a non-live pick posts itself to the spec-scoped route", () => {
  const posts = (h: ReturnType<typeof harness>) =>
    h.requests.filter((r) => r.url.includes("/api/queue/specs/"));

  test("a hand-made model pick posts the project, folder, step and model", async () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    await h.changeModel(0, "fable"); // create — not live
    const posted = posts(h)[0]!;
    expect(posted.url).toContain("/api/queue/specs/aide/127-one-ai/model");
    expect(String(posted.init.body)).toContain("step=create");
    expect(String(posted.init.body)).toContain("model=fable");
  });

  test("an AI pick that fills a non-live model posts the model it just wrote", async () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    await h.changeAi(1, "codex"); // analyze — not live
    const posted = posts(h)[0]!;
    expect(posted.url).toContain("/api/queue/specs/aide/127-one-ai/model");
    expect(String(posted.init.body)).toContain("step=analyze");
    expect(String(posted.init.body)).toContain("model=codex-fast");
    expect(String(posted.init.body)).toContain("provider=codex");
  });

  // The live phase (`archive`, index 3) keeps posting to the running
  // job's own route and never to this new one — the two
  // routes are for two different moments and must not both fire.
  test("a live pick still posts to the job's own route, not the spec-scoped one", async () => {
    const h = harness(() => ({
      ok: true,
      body: { ok: true, job: { id: "job-1" } },
    }));
    await h.changeModel(3, "fable"); // archive — live
    expect(posts(h)).toHaveLength(0);
    expect(
      h.requests.some((r) => r.url.includes("/api/queue/job-1/model")),
    ).toBe(true);
  });

  test("a refused live model change without an error names its action and HTTP status (AC-4)", async () => {
    const h = harness(() => ({ ok: false, status: 502, body: null }));
    await h.changeModel(3, "fable");
    await flush();
    expect(h.listRefused.textContent).toBe(
      "Problem: Change the model failed with HTTP 502",
    );
  });

  for (const reply of [
    { ok: false, status: 404, body: null },
    { ok: true, status: 200, body: { ok: false } },
  ]) {
    test(`a refused model change without an error names its action and HTTP ${reply.status} (AC-4)`, async () => {
      const h = harness(() => reply);
      await h.changeModel(0, "fable");
      await flush();
      expect(h.listRefused.textContent).toBe(
        `Problem: Change the model failed with HTTP ${reply.status}`,
      );
    });
  }
});
