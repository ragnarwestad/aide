// Spec 350, REQ-6: the state words come from a per-language, per-step
// table, not from stepLabel() + "ing" — and the drift guard from Risk
// analysis: a step WORKFLOW_STEPS knows about must have both an English
// and a Norwegian entry, so a future step added there fails this test
// rather than silently falling back to English prose in Norwegian mode.
import { describe, expect, test } from "bun:test";
import { WORKFLOW_STEPS } from "../../../../src/queue/steps.ts";
import { GERUND_EN, GERUND_NB, specStateChip, restingChip } from "../../../../src/render/ui/job-state/resting.ts";
import { specNotice } from "../../../../src/render/ui/job-state/notice.ts";
import type { QueueRowView } from "../../../../src/render/ui/job-state/types.ts";

describe("GERUND_EN/GERUND_NB (spec 350)", () => {
  test("every WORKFLOW_STEPS member has an entry in both tables", () => {
    for (const step of WORKFLOW_STEPS) {
      expect(GERUND_EN[step], `GERUND_EN is missing "${step}"`).toBeDefined();
      expect(GERUND_NB[step], `GERUND_NB is missing "${step}"`).toBeDefined();
    }
  });
});

const row = (over: Partial<QueueRowView> = {}): QueueRowView => ({
  id: "j1",
  project: "aide",
  specFolder: "1-x",
  steps: ["analyze"],
  stepIndex: 0,
  state: "running",
  spentUsd: 0,
  timeoutSec: 600,
  createdAt: "2026-09-01T00:00:00Z",
  ...over,
});

describe("specStateChip/restingChip take lang (spec 350)", () => {
  test("a running row's badge reads the Norwegian table word, not stepLabel + ing", () => {
    const html = specStateChip(row({ state: "running", steps: ["analyze"], stepIndex: 0 }), "nb");
    expect(html).toContain("analyserer");
    expect(html).not.toContain("analyzing");
  });

  test("a queued row's badge reads '{Norwegian gerund} i kø'", () => {
    const html = specStateChip(row({ state: "queued", steps: ["implement"], stepIndex: 0 }), "nb");
    expect(html).toContain("implementerer i kø");
  });

  test("restingChip's resting-state words are Norwegian for nb", () => {
    expect(restingChip("nb", { readyPhase: "implement" })).toContain("klar");
    expect(restingChip("nb", {})).toContain("ferdig");
    // The badge says the STATE since 2026-09-08 — the same word every
    // other stop the system made gets — and the reason is the sentence
    // on the row's own notice line. The word itself was hardcoded
    // English until it took the key the held-back badge uses.
    expect(restingChip("nb", { archiveHeldBack: "a reason" })).toContain("stoppet");
  });

  test("English is unchanged (REQ-5)", () => {
    const html = specStateChip(row({ state: "running", steps: ["analyze"], stepIndex: 0 }), "en");
    expect(html).toContain("analyzing");
  });
});

// Spec 396: a queued job the runner is holding back is not competing for
// a slot, so its badge must not carry the n/total wording meant for a job
// that is.
describe("specStateChip() on a held-back queued row (spec 396)", () => {
  // And it says the bare word (2026-09-08). It read "implementing held
  // back" until then — the step is already named on the line, and the
  // half a reader acts on is the reason, which the row's own notice
  // line says in full underneath.
  test("reads 'stopped', with no step and no n/total figure", () => {
    const html = specStateChip(
      row({ state: "queued", steps: ["implement"], stepIndex: 0, errorReason: "held-back" }),
      "en",
    );
    expect(html).toContain(">stopped<");
    expect(html).not.toContain("implementing");
    expect(html).not.toMatch(/\d+\/\d+/);
  });

  // Norwegian too: the word was hardcoded English for the sibling state
  // ("archive held back") until the two shared one key.
  test("Norwegian says stoppet, not the English word", () => {
    const html = specStateChip(
      row({ state: "queued", steps: ["implement"], stepIndex: 0, errorReason: "held-back" }),
      "nb",
    );
    expect(html).toContain(">stoppet<");
  });

  test("the badge and the row's own notice agree it is held back, not queued for a slot (REQ-5)", () => {
    const heldRow = row({
      state: "queued",
      steps: ["implement"],
      stepIndex: 0,
      errorReason: "held-back",
      error: "held back: depends on 80-x, which is not archived yet",
    });
    const badgeHtml = specStateChip(heldRow, "en");
    const notice = specNotice(heldRow);

    expect(badgeHtml).toContain(">stopped<");
    expect(badgeHtml).not.toMatch(/\d+\/\d+/);
    // `<phase> <what happened>: <the longer sentence>` — the phase and
    // the state word as one phrase: "implement held back: …".
    expect(notice?.text.startsWith("implement held back:")).toBe(true);
  });
});
