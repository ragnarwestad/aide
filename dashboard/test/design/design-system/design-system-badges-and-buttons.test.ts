// Every state picks a badge, and the primary button says what pressing
// it does. Split out of design-system.test.ts by theme.
import { describe, expect, test } from "bun:test";
import { row, rows, target } from "../design-system-fixtures.ts";
import type { SpecsPageOptions, QueueRowView } from "../../../src/render";
import { wordPhase } from "../../../src/render/ui/job-state";
import { badge } from "../../../src/render/ui/components";
import { restingChip, specStateChip } from "../../../src/render/ui/job-state";

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
    expect(badgeOf("stopped", { stopReason: "timeout" })).toBe("b-waiting");
  });

  test("failed is danger", () => {
    expect(badgeOf("failed")).toBe("b-refused");
  });

  test("interrupted is danger, grouped with failed as it always was", () => {
    expect(badgeOf("interrupted")).toBe("b-refused");
  });

  test("cancelled is a stop somebody chose: amber like stopped, never red, never grey", () => {
    expect(badgeOf("cancelled")).toBe("b-waiting");
  });
});

describe("refused and running are told apart by more than the word", () => {
  test("the refused badge carries a border the running one does not", async () => {
    const { CSS } = await import("../../../src/render/ui/css");
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
    expect(html).toContain('class="refused rowmsg failed"');
    expect(html).toMatch(/class="refused rowmsg failed">\s*<svg/);
  });
});

// Spec 372, REQ-5: the State column's own badges pinned by name, so a
// future edit cannot move one of the three off its colour unnoticed —
// `held back`/`stopped` amber, `failed` red, `done`/`queued` neutral.
// The first four already had a badgeOf() case each, over `state`; these
// three go straight to the functions that decide the class, since
// `queued`/`done` also depend on resting state (what else the spec is
// ready for) that a bare `row({ state })` does not carry, and `held
// back` is a PHASE badge (wordPhase()'s own "waiting" variant), not a
// job state at all.
describe("REQ-5 — held back, queued and done pinned by name", () => {
  test("queued is neutral (b-idle)", () => {
    const html = specStateChip(row({ state: "queued", steps: ["analyze"], stepIndex: 0 }), "en");
    expect(html).toContain('class="badge b-idle"');
  });

  test("done, with nothing else the spec is ready for, is neutral (b-done)", () => {
    expect(restingChip("en", {})).toContain('class="badge b-done"');
  });

  test("held back is the same amber as stopped (b-waiting)", () => {
    const word = wordPhase(false, { reason: "depends on 1-x, which is not archived yet" }, undefined, {});
    expect(word.badge).toEqual({ variant: "waiting", label: "Held back" });
  });
});

// Spec 321: a control disabled via `aria-disabled` (an `<a href>`-shaped
// control, like `resetControl`) must look as inert as one disabled via
// the native `disabled` attribute — today only `.btn:disabled` is styled.
describe("a control disabled via aria-disabled looks as inert as one disabled natively", () => {
  test("the .btn[aria-disabled=\"true\"] rule shares .btn:disabled's declarations", async () => {
    const { CSS } = await import("../../../src/render/ui/css");
    const rule = CSS.match(/\.btn:disabled[^{]*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("opacity: 0.45");
    expect(rule).toContain("cursor: default");
    expect(CSS).toMatch(/\.btn:disabled[^{]*\.btn\[aria-disabled="true"\][^{]*\{/);
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
});

// --- spec 171: a conflict is archive's to resolve ---------------------------
//
// A conflict that reaches a reader is one no machine could settle, and
// the row says so in the failure's own text beside the ordinary re-run
// every other failed step offers.

describe("a conflict refusal (spec 171)", () => {
  const CONFLICT = {
    error: "cannot merge aide/102 into main in /repos/aide (conflict)",
    errorReason: "conflict" as const,
  };

  const conflicted = (opts: Partial<SpecsPageOptions> = {}) =>
    rows([row({ state: "done", ...CONFLICT })], { targets: [target()], ...opts });

  test("offers the ordinary re-run, the same control every other failed step's row carries", () => {
    const html = conflicted();
    expect(html).toMatch(/<button[^>]*form="rowrun/);
  });
});

// The badge is the word and its colour. A dot in front of it marked the
// four live variants apart from the two settled ones until 2026-09-07;
// the colour already says that, and the mark was one more thing in
// front of the word on a row read on a phone.
describe("the status badge carries no mark of its own", () => {
  test("no dot in the markup, for any variant", () => {
    for (const variant of ["idle", "running", "waiting", "ready", "refused", "done"] as const) {
      // The word comes back capitalised: a badge is a message of its own,
      // and the catalogue keeps its entries lowercase for the places that
      // glue them behind something else.
      const Word = variant.charAt(0).toUpperCase() + variant.slice(1);
      expect([variant, badge(variant, variant)]).toEqual([
        variant,
        `<span class="badge b-${variant}">${Word}</span>`,
      ]);
    }
  });

  // The idle pill is painted on the page's own ground, so without an
  // edge "queued" read as plain text. "done" is green since 2026-09-11
  // — the same tones as ready, and as the pip beside it.
  test("the idle pill has an edge of its own, and done is the pip's green", async () => {
    const { CSS } = await import("../../../src/render/ui/css");
    expect(CSS).toMatch(/\.b-idle \{[^}]*border-color: var\(--line\)/);
    expect(CSS).toMatch(/\.b-done \{ background: var\(--ok-soft\); color: var\(--ok\); \}/);
  });
});
