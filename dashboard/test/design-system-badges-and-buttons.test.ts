// Every state picks a badge, and the primary button says what pressing
// it does. Split out of design-system.test.ts by theme.
import { describe, expect, test } from "bun:test";
import { row, rows, target } from "./design-system-fixtures.ts";
import type { QueuePageOptions, QueueRowView } from "../src/render.ts";

// --- every state picks a badge -----------------------------------------------

// Five of the ten had an example on the design sheet. These four did
// not, so the mapping was decided in the plan and is asserted by name
// here rather than left to the general "the page still renders" cover.
describe("the four states with no example on the design sheet", () => {
  const badgeOf = (state: QueueRowView["state"], extra: Partial<QueueRowView> = {}) => {
    const html = rows([row({ state, stepIndex: 0, ...extra })]);
    return html.match(/<span class="badge (b-[a-z]+)"/)?.[1] ?? "";
  };

  test("stopped is a notice, not a failure — the same amber as waiting", () => {
    expect(badgeOf("stopped", { stopReason: "budget" })).toBe("b-waiting");
  });

  test("failed is danger", () => {
    expect(badgeOf("failed")).toBe("b-refused");
  });

  test("interrupted is danger, grouped with failed as it always was", () => {
    expect(badgeOf("interrupted")).toBe("b-refused");
  });

  test("cancelled is a deliberate ending, not a failure", () => {
    expect(badgeOf("cancelled")).toBe("b-idle");
  });
});

describe("refused and running are told apart by more than the word", () => {
  test("the refused badge carries a border the running one does not", async () => {
    const { CSS } = await import("../src/render/ui/css.ts");
    const refused = CSS.match(/\.b-refused\s*\{([^}]*)\}/)?.[1] ?? "";
    const running = CSS.match(/\.b-running\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(refused).toContain("border-color: var(--danger)");
    expect(running).not.toContain("border-color:");
    expect(refused).toContain("var(--danger-soft)");
    expect(running).toContain("var(--accent-soft)");
  });

  test("a refusal on the row is a message with the warning mark, not colour alone", () => {
    const html = rows([row({ state: "failed" })], {
      targets: [target()],
      error: "cannot merge aide/102-… into main — conflict",
      errorSpec: "aide/102-design-foundation",
    });
    expect(html).toContain('class="refused rowmsg err"');
    expect(html).toMatch(/class="refused rowmsg err">\s*<svg/);
  });
});
// "Also touches" had a group of its own here: it lived in the action
// cell beside the button, and four tests pinned it there. The control
// is gone — 0 of 200 jobs ever named an extra repo, and it drew a tick
// box per project on every open row — so the tests went with it.


// --- the button says what pressing it does ------------------------------------

describe("the primary button's label per row state (the design sheet's table)", () => {
  const buttons = (html: string) =>
    [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
      m[1]!.replace(/<[^>]*>/g, "").trim(),
    );

  test("a spec nothing has ever run is offered its first two phases", () => {
    expect(buttons(rows([], { targets: [target()] }))).toContain("Analyze");
  });

  // The bare word "Run" went in spec 157, and "Run again" before it
  // (2026-08-19): the again-variant guessed at history and guessed
  // wrong at the edges. The button names the phase a press would run,
  // which is the thing both wordings were groping for.
  test("the button names the phase a press would run, whatever has already run", () => {
    for (const [done, label] of [
      [[], "Analyze"],
      [["analyze"], "Implement"],
      [["analyze", "implement"], "Archive"],
    ] as const) {
      const t = target({ done: [...done] });
      const b = buttons(rows([row({ state: "done" })], { targets: [t] }));
      expect(b).toContain(label);
      expect(b).not.toContain("Run again");
      expect(b).not.toContain("Run");
    }
  });

  test("a running job offers Cancel and nothing else", () => {
    const html = rows([row({ state: "running" })], { targets: [target()] });
    // Named for the step it would stop, so it reads like the Run
    // button it replaces (spec 157).
    expect(buttons(html)).toContain("Cancel");
    // No Run at all — a greyed-out one beside a live Cancel is the
    // second control this spec removes. The busy VARIANT carries a
    // spinner, and the running phase chip already has the row's one;
    // two spinners read as two jobs (2026-08-19).
    expect(html).not.toMatch(/<button[^>]*form="rowrun/);
    expect(html).not.toContain(">Run<");
    const cancel = html.match(/<button[^>]*>Cancel<\/button>/)?.[0] ?? "";
    expect(cancel).not.toContain("busy");
  });

  // Spec 149: there is no Merge button at all any more, and the State
  // line stopped naming what one would land. A finished spec with a
  // branch still open says which PHASE is next, in the State column and
  // there alone — the repo list carries links and nothing else.
  test("a finished spec with an open branch offers no merge, and asks for none", () => {
    const html = rows([row({ state: "done" })], { targets: [target()] });
    expect(buttons(html)).not.toContain("Merge");
    expect(html).not.toContain("ready to merge");
    expect(html).not.toContain("waiting for archive");
  });

});

// --- spec 171: no way out is OFFERED, because archive takes it itself --------
//
// There was a Resolve control here, narrowly gated to one refusal class
// among several. Spec 171 folded resolving into `archive`, so the
// control is gone and the test that matters is the one that says it is
// absent everywhere — under every refusal class, on an open row and a
// shut one alike. A conflict that reaches a reader is one no machine
// could settle, and the row says so in the failure's own text beside the
// ordinary re-run every other failed step offers.

describe("no Resolve control (spec 171)", () => {
  const buttons = (html: string) =>
    [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
      m[1]!.replace(/<[^>]*>/g, "").trim(),
    );

  const CONFLICT = {
    error: "cannot merge aide/102 into main in /repos/aide (conflict)",
    errorReason: "conflict" as const,
  };

  const conflicted = (opts: Partial<QueuePageOptions> = {}) =>
    rows([row({ state: "done", ...CONFLICT })], { targets: [target()], ...opts });

  test("a conflict refusal draws no control of its own", () => {
    const html = conflicted();
    expect(html).not.toContain("resolveform");
    expect(buttons(html)).not.toContain("Resolve");
    // The hand route the reader had before spec 149 is gone too.
    expect(buttons(html)).not.toContain("Merge");
    // What it DOES offer is the ordinary re-run — the same control
    // every other failed step's row carries.
    expect(html).toMatch(/<button[^>]*form="rowrun/);
  });

  test("a collapsed row draws none either", () => {
    const html = conflicted({ filter: {} });
    expect(html).not.toContain("resolveform");
    expect(buttons(html)).not.toContain("Resolve");
  });

  test("no refusal class draws one", () => {
    // The three the merge route can produce beside a conflict, and the
    // conflict itself. None of them offers a press of its own now.
    for (const error of [
      "cannot fast-forward main in /repos/aide",
      "aide/102 is not on origin in /repos/aide — there is nothing left to merge",
      "merged locally in /repos/aide, but the push of main failed",
      CONFLICT.error,
    ]) {
      const html = rows([row({ state: "done", error })], { targets: [target()] });
      expect(`${error}: ${html.includes("resolveform")}`).toBe(`${error}: false`);
    }
  });

  test("nothing on the page queues a resolve step", () => {
    expect(conflicted()).not.toMatch(/name="steps"\s+value="resolve"/);
  });
});
