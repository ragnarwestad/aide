// Spec 350, REQ-6: the state words come from a per-language, per-step
// table, not from stepLabel() + "ing" — and the drift guard from Risk
// analysis: a step WORKFLOW_STEPS knows about must have both an English
// and a Norwegian entry, so a future step added there fails this test
// rather than silently falling back to English prose in Norwegian mode.
import { describe, expect, test } from "bun:test";
import { WORKFLOW_STEPS } from "../../../../src/queue/steps.ts";
import {
  GERUND_EN, GERUND_NB, GERUND_ES, GERUND_DE, GERUND_FR, specStateChip, restingChip,
} from "../../../../src/render/ui/job-state/resting.ts";
import { specNotice } from "../../../../src/render/ui/job-state";
import { STEP_LABELS_NB, STEP_LABELS_ES, STEP_LABELS_DE, STEP_LABELS_FR, stepLabel } from "../../../../src/render/ui/components";
import { stepButton } from "../../../../src/format/step-label.ts";
import type { QueueRowView } from "../../../../src/render";

describe("GERUND_EN/GERUND_NB/GERUND_ES/GERUND_DE/GERUND_FR (spec 350, 484)", () => {
  test("every WORKFLOW_STEPS member has an entry in every table", () => {
    for (const step of WORKFLOW_STEPS) {
      expect(GERUND_EN[step], `GERUND_EN is missing "${step}"`).toBeDefined();
      expect(GERUND_NB[step], `GERUND_NB is missing "${step}"`).toBeDefined();
      expect(GERUND_ES[step], `GERUND_ES is missing "${step}"`).toBeDefined();
      expect(GERUND_DE[step], `GERUND_DE is missing "${step}"`).toBeDefined();
      expect(GERUND_FR[step], `GERUND_FR is missing "${step}"`).toBeDefined();
    }
  });
});

// The same guard for the phase's NAME. English is the step's own id, so
// there is nothing to keep in step there; every other language is a real
// table, and a step added to WORKFLOW_STEPS without an entry would read
// as English on a board that is not.
describe("STEP_LABELS_NB/STEP_LABELS_ES/STEP_LABELS_DE/STEP_LABELS_FR", () => {
  test("every WORKFLOW_STEPS member has a name in every language", () => {
    for (const step of WORKFLOW_STEPS) {
      expect(STEP_LABELS_NB[step], `STEP_LABELS_NB is missing "${step}"`).toBeDefined();
      expect(STEP_LABELS_ES[step], `STEP_LABELS_ES is missing "${step}"`).toBeDefined();
      expect(STEP_LABELS_DE[step], `STEP_LABELS_DE is missing "${step}"`).toBeDefined();
      expect(STEP_LABELS_FR[step], `STEP_LABELS_FR is missing "${step}"`).toBeDefined();
    }
  });

  test("phase names use the Norwegian imperative", () => {
    expect(stepLabel("create", "nb")).toBe("Opprett");
    expect(stepLabel("analyze", "nb")).toBe("Analyser");
    expect(stepLabel("implement", "nb")).toBe("Implementer");
    expect(stepLabel("archive", "nb")).toBe("Arkiver");
    expect(stepLabel("explore", "nb")).toBe("Utforsk");
    expect(stepLabel("manifest", "nb")).toBe("Manifest");
    expect(stepLabel("reopen", "nb")).toBe("Gjenåpne");
    expect(stepLabel("reset", "nb")).toBe("Tilbakestill");
    expect(stepLabel("schedule", "nb")).toBe("Kjøring");
    expect(stepLabel("close", "nb")).toBe("Lukk");
  });

  test("row buttons keep their English step word", () => {
    expect(stepButton("archive")).toBe("Archive");
  });

  // Spec 484: a sanity check that each new language's table carries
  // real text, not a fallback to English — the completeness loop above
  // already proves every step is present.
  test.each(["es", "de", "fr"] as const)("%s phase names are not the English fallback", (lang) => {
    for (const step of WORKFLOW_STEPS) {
      expect(stepLabel(step, lang)).not.toBe(step);
    }
    expect(stepLabel("analyze", lang)).not.toBe(stepLabel("analyze", "en"));
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
    expect(html).toContain("Analyserer");
    expect(html).not.toContain("Analyzing");
  });

  test("a queued row's badge reads '{Norwegian gerund} i kø'", () => {
    const html = specStateChip(row({ state: "queued", steps: ["implement"], stepIndex: 0 }), "nb");
    expect(html).toContain("Implementerer i kø");
  });

  test("restingChip's resting-state words are Norwegian for nb", () => {
    expect(restingChip("nb", { readyPhase: "implement" })).toContain("Klar");
    expect(restingChip("nb", {})).toContain("Ferdig");
    // The badge says the STATE since 2026-09-08 — the same word every
    // other stop the system made gets — and the reason is the sentence
    // on the row's own notice line. The word itself was hardcoded
    // English until it took the key the held-back badge uses.
    expect(restingChip("nb", { archiveHeldBack: "a reason" })).toContain("Stoppet");
  });

  test("English is unchanged (REQ-5)", () => {
    const html = specStateChip(row({ state: "running", steps: ["analyze"], stepIndex: 0 }), "en");
    expect(html).toContain("Analyzing");
  });
});

// Spec 396: a queued job the runner is holding back is not competing for
// a slot, so its badge must not carry the n/total wording meant for a job
// that is. Spec 485: the word is its own ("Held back"), never "Stopped" —
// a hold is a routine wait, not a stop — and its colour follows the same
// neutral/amber split the row's own notice line already uses.
describe("specStateChip() on a held-back queued row (spec 396, spec 485)", () => {
  // A hold that resolves on its own (a dependency not archived yet) reads
  // neutral, with no step and no n/total figure.
  test("a dependency hold reads 'Held back', neutral, with no step and no n/total figure", () => {
    const html = specStateChip(
      row({
        state: "queued",
        steps: ["implement"],
        stepIndex: 0,
        errorReason: "held-back",
        error: { key: "runner.dependencyNotArchived", values: { folder: "80-x" } },
      }),
      "en",
    );
    expect(html).toContain(">Held back<");
    expect(html).toContain("b-idle");
    expect(html).not.toContain("Implementing");
    expect(html).not.toMatch(/\d+\/\d+/);
  });

  // A hold that waits on a person (not analyzed yet) reads amber.
  test("a not-analyzed hold reads 'Held back', amber", () => {
    const html = specStateChip(
      row({
        state: "queued",
        steps: ["implement"],
        stepIndex: 0,
        errorReason: "held-back",
        error: { key: "runner.notAnalyzed" },
      }),
      "en",
    );
    expect(html).toContain(">Held back<");
    expect(html).toContain("b-waiting");
  });

  // Norwegian too: the word was hardcoded English ("Stopped") until it
  // took its own key.
  test("Norwegian says Holdt tilbake, not the English word", () => {
    const html = specStateChip(
      row({
        state: "queued",
        steps: ["implement"],
        stepIndex: 0,
        errorReason: "held-back",
        error: { key: "runner.dependencyNotArchived", values: { folder: "80-x" } },
      }),
      "nb",
    );
    expect(html).toContain(">Holdt tilbake<");
  });

  test("the badge and the row's own notice agree it is held back, not queued for a slot (REQ-5)", () => {
    const heldRow = row({
      state: "queued",
      steps: ["implement"],
      stepIndex: 0,
      errorReason: "held-back",
      error: { key: "runner.dependencyNotArchived", values: { folder: "80-x" } },
    });
    const badgeHtml = specStateChip(heldRow, "en");
    const notice = specNotice(heldRow);

    expect(badgeHtml).toContain(">Held back<");
    expect(badgeHtml).not.toMatch(/\d+\/\d+/);
    // `<phase> <what happened>: <the longer sentence>` — the phase and
    // the state word as one phrase: "implement held back: …".
    expect(notice?.text.startsWith("Implement held back:")).toBe(true);
  });

  // AC-3: a job that actually stopped still reads "Stopped" — the fix is
  // scoped to a queued job's own hold, never to a real stop.
  test("a job that actually stopped still reads 'Stopped'", () => {
    const html = specStateChip(
      row({ state: "stopped", steps: ["implement"], stepIndex: 0, stopReason: "timeout" }),
      "en",
    );
    expect(html).toContain(">Stopped<");
  });
});
